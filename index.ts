import * as cheerio from 'cheerio';
import csv from 'csv-parser';
import * as fs from 'fs';
import puppeteer from 'puppeteer';

const inputFilePath = 'Export-Translation-ES-False.csv';
const outputFilePath = `output.csv`; // _${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
const logFilePath = 'log.txt';
const debug = false; // Affiche dans la console les logs et le tableur final, et non pas dans les fichiers.
const startIterations = 0; // À partir de quelle itération commence la lecture des traductions source à traiter.
const maxIterations = 999; // Nombre maximum d'itérations de traductions source à traiter.

// Variables globales pour les timeouts (millisecondes)
const pageLoadTimeout = 10000; // Temps d'attente pour le chargement de la page Deepl
const selectorTimeout = 3000; // Timeout pour la sélection du champs de traduction Deepl
const requestRangeDelay: [min: number, max: number] = [1000, 6000]; // Délai après les requêtes foireuses

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

const translateText = async (text: string, sourceLang: string, targetLang: string, attempts: number): Promise<string> => {
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

const logMessage = (message: string) => {
  const formattedMessage = `[${new Date().toISOString()}] ${message}`;
  if (debug) {
    console.log(formattedMessage);
  } else {
    fs.appendFileSync(logFilePath, formattedMessage + '\n');
  }
};

const getRandomDelay = (range: [min: number, max: number]) => Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];

const translateCSV = async (sourceLang: Lang, targetLangs: Lang[]) => {
  const rows: Row[] = [];
  const detectedLangs: Lang[] = [];

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
      let iterationCount = 0;
      logMessage('--- Début de l\'éxecution ---');
      rowsLoop: for (let i = startIterations; i < rows.length; i++) {
        const row = rows[i];
        if (iterationCount >= maxIterations) {
          break;
        }
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
              row[langKey] = '';
              row[translateKey] = 'False';
              logMessage(` Échec de traduction vers ${targetLang.excelColumnName} (${targetLang.deeplParamName}) après 3 tentatives`);
              logMessage(` ERROR Deepl: too many requests`); // Erreur supposée: trop de requêtes envoyées à Deepl
              logMessage(` Abandon de l'exécution des traductions, itérations réussies: ${startIterations}-${iterationCount} / ${rows.length}`);
              break rowsLoop;
            }
          }
          iterationCount++;
        }
      }
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
      if (debug) {
        console.log('Contenu du fichier traduit :');
        console.log(headers.map(header => header.title).join(','));
        rows.forEach(row => {
          console.log(headers.map(header => row[header.id]).join(','));
        });
      } else {
        const csvWriter = require('csv-writer').createObjectCsvWriter({
          path: outputFilePath,
          header: headers
        });
        await csvWriter.writeRecords(rows);
        logMessage(`Fichier traduit avec succès : ${outputFilePath}`);
      }
      logMessage('--- Fin de l\'éxecution ---');
    });
};

// Appel de la fonction avec les langues source et cibles
const sourceLang: Lang = { excelColumnName: 'US', deeplParamName: 'en' };
const targetLangs: Lang[] = [
  { excelColumnName: 'ES', deeplParamName: 'es' },
  { excelColumnName: 'IT', deeplParamName: 'it' },
  { excelColumnName: 'DE', deeplParamName: 'de' },
];
translateCSV(sourceLang, targetLangs);