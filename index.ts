import * as cheerio from 'cheerio';
import csv from 'csv-parser';
import { CsvWriter } from 'csv-writer/src/lib/csv-writer';
import * as fs from 'fs';
import puppeteer from 'puppeteer';

// Options pour pouvoir relancer le programme à un endroit précis, suite à un plantage en cours de route par ex.
const startIterations = 0; // À partir de quelle itération commence la lecture des traductions source à traiter.
const maxIterations = 2; // Nombre maximum d'itérations de traductions source à traiter.

// Variables globales pour les timeouts (millisecondes)
const pageLoadTimeout = 10000; // Temps d'attente pour le chargement de la page Deepl
const selectorTimeout = 3000; // Timeout pour la sélection du champs de traduction Deepl
const requestRangeDelay: [min: number, max: number] = [1000, 6000]; // Délai après les requêtes foireuses

let csvWriter: CsvWriter<Row>; // Instantiated in initOutputCSV() 

interface Row {
  IdExtern: string;
  [key: string]: string;
  Comments: string;
  Category: string;
  KeyFct: string;
  Web: string;
}

interface Lang {
  excelColumnName: string;
  deeplParamName: string;
}

const getRandomDelay = (range: [min: number, max: number]) => Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];

const logMessage = (message: string) => {
  const formattedMessage = `[${new Date().toISOString()}] ${message}`;
  fs.appendFileSync(logFilePath, formattedMessage + '\n');
};

function initOutputCSV(sourceLang: Lang, targetLangs: Lang[]): void {
  const headers = [
    { id: 'IdExtern', title: 'IdExtern' },
    { id: sourceLang.excelColumnName.toUpperCase(), title: sourceLang.excelColumnName.toUpperCase() },
    { id: `${sourceLang.excelColumnName.toUpperCase()} Translate`, title: `${sourceLang.excelColumnName.toUpperCase()} Translate` },
    ...targetLangs.flatMap(lang => [
      { id: lang.excelColumnName.toUpperCase(), title: lang.excelColumnName.toUpperCase() },
      { id: `${lang.excelColumnName.toUpperCase()} Translate`, title: `${lang.excelColumnName.toUpperCase()} Translate` }
    ]),
    { id: 'Comments', title: 'Comments' },
    { id: 'Category', title: 'Category' },
    { id: 'KeyFct', title: 'KeyFct' },
    { id: 'Web', title: 'Web' }
  ];

  csvWriter = require('csv-writer').createObjectCsvWriter({
    path: outputFilePath,
    header: headers
  });
}

async function translateText(text: string, sourceLang: string, targetLang: string, attempts: number): Promise<string> {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  const url = `https://www.deepl.com/translator#${sourceLang}/${targetLang}/${encodeURIComponent(text)}`;
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[aria-labelledby="translation-target-heading"]', { timeout: selectorTimeout * attempts });
  await page.waitForTimeout(pageLoadTimeout * attempts);
  const pageContent = await page.content();
  const $ = cheerio.load(pageContent);
  const translatedText = $('[aria-labelledby="translation-target-heading"] p')
    .map((_, p) => $(p).text())
    .get()
    .join('\n');
  await browser.close();
  return translatedText;
};

async function translateCSV(sourceLang: Lang, targetLangs: Lang[]): Promise<void> {
  const rows: Row[] = [];
  const detectedLangs: Lang[] = [];

  initOutputCSV(sourceLang, targetLangs);

  fs.createReadStream(inputFilePath)
    .pipe(csv())
    .on('headers', (headers: string[]) => {
      headers.forEach(header => {
        const match = header.match(/^(.*) Translate$/);
        if (match) {
          const lang = match[1];
          if (lang !== sourceLang.excelColumnName && !detectedLangs.some(l => l.excelColumnName === lang)) {
            detectedLangs.push({ excelColumnName: lang, deeplParamName: lang.toLowerCase() });
          }
        }
      });
    })
    .on('data', (data: Row) => rows.push(data))
    .on('end', async () => {
      logMessage('--- Début de l\'éxecution ---');
      
      let iterationCount = 0;
      
      rowsLoop: for (let i = startIterations; i < rows.length; i++) {
        if (iterationCount >= maxIterations) {
          break;
        }
        const row = rows[i];
        const sourceText = row[sourceLang.excelColumnName.toUpperCase()];

        if (sourceText) {
          logMessage(`Source: ${sourceText} (${sourceLang.excelColumnName} - ${sourceLang.deeplParamName})`);

          for (const targetLang of targetLangs) {
            const langKey = targetLang.excelColumnName.toUpperCase();
            const translateKey = `${langKey} Translate`;

            if (row[translateKey] !== 'False') {
              logMessage(` Traduction déjà effectuée ou non spécifiée pour ${targetLang.excelColumnName} (${targetLang.deeplParamName})`);
              continue;
            }

            let translatedText = '';
            let attempts = 0;

            while (attempts < 3 && !translatedText) {
              try {
                attempts++;
                translatedText = await translateText(sourceText, sourceLang.deeplParamName, targetLang.deeplParamName, attempts);
                if (translatedText) {
                  row[langKey] = translatedText;
                  row[translateKey] = 'False';
                  logMessage(` Traduction vers ${targetLang.excelColumnName} (${targetLang.deeplParamName}): ${translatedText}`);
                } else {
                  logMessage(` Tentative ${attempts} échouée pour ${targetLang.excelColumnName} (${targetLang.deeplParamName})`);
                }
              } catch (error: any) {
                logMessage(` Erreur de traduction vers ${targetLang.excelColumnName} (${targetLang.deeplParamName}) à la tentative ${attempts}: ${error.message}`);
              }
              await getRandomDelay(requestRangeDelay); // Ajout d'un délai entre les requêtes
            }
            if (!translatedText) {
              logMessage(` Échec de traduction vers ${targetLang.excelColumnName} (${targetLang.deeplParamName}) après 3 tentatives`);
              logMessage(` ERROR Deepl: too many requests`); // Erreur supposée: trop de requêtes envoyées à Deepl
              logMessage(` Abandon de l'exécution des traductions, itérations réussies: ${startIterations}-${iterationCount} / ${rows.length}`);

              break rowsLoop;
            }
          }
          await csvWriter.writeRecords([row]);
          iterationCount++;
        }
      }
      logMessage(`Fichier traduit avec succès : ${outputFilePath}`);
      logMessage('--- Fin de l\'éxecution ---');
      process.exit(0);
    });
};

process.on('SIGINT', () => {
  logMessage('--- Process terminé par l\'utilisateur. ---');
  process.exit(0);
});


// MAIN setup & call
const inputFilePath = 'Export-Translation-ES-False.csv';
const outputFilePath = `output.csv`; // _${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
const logFilePath = 'log.txt';
const sourceLang: Lang = { excelColumnName: 'US', deeplParamName: 'en' };
const targetLangs: Lang[] = [
  { excelColumnName: 'ES', deeplParamName: 'es' },
  { excelColumnName: 'IT', deeplParamName: 'it' },
  { excelColumnName: 'DE', deeplParamName: 'de' },
];
translateCSV(sourceLang, targetLangs);

