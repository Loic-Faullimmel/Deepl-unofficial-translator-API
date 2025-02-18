# Deepl Unofficial Translator API

## Description
This project is a TypeScript script designed to scrape translation data from the Deepl website. It reads a CSV file containing text in various languages and translates the text into specified target languages using Deepl.

## Project Structure
- `package.json`: Contains the project dependencies and scripts.
- `index.ts`: The main script that handles the translation process.
- `log.txt`: Log file containing the logs of the translation process.
- `output.csv`: Output file containing the results of the translation process.

## Installation
1. Clone the repository.
2. Navigate to the project directory.
3. Install the dependencies:
    ```sh
    npm install
    ```

## Usage
To start the translation process, run the following command:
```sh
npm run start
```

## CSV Structure
The input CSV must contain the following columns:
- `IdExtern`: Unique identifier for each row.
- `[lang]`, `[lang] Translate`: Text and translation status for any language.
- `Comments`, `Category`, `KeyFct`, `Web`: Additional metadata.

### CSV Requirements
The input CSV must contain at least two languages:
- One language as the source for translation.
- One or more languages as the target(s) for translation.

Each language must have a corresponding Deepl language code specified in the script. The CSV should include columns for the text and its translation status for each language.

Example:
```csv
"IdExtern","US","US Translate","DE","DE Translate","ES","ES Translate","IT","IT Translate","Comments","Category","KeyFct","Web"
"30312","Contact support","False","Support kontaktieren","False","Contactar con el servicio de asistencia","False","Contatto con l'assistenza","False","","Loicos.App","",""
```

## Setup

### Constants
The script defines several constants to control its behavior:
- `startIterations`: Specifies the starting iteration for processing translations. Useful for resuming the process after a failure.
- `maxIterations`: The maximum number of iterations to process.
- `pageLoadTimeout`: Timeout for loading the Deepl page (in milliseconds).
- `selectorTimeout`: Timeout for selecting the Deepl translation field (in milliseconds).
- `requestRangeDelay`: Range of delays between requests to avoid being blocked by Deepl (in milliseconds).

### Inputs
The script requires the following inputs:
- `inputFilePath`: Path to the input CSV file containing the text to be translated.
- `outputFilePath`: Path to the output CSV file where the translated text will be saved.
- `logFilePath`: Path to the log file where the process logs will be written.
- `sourceLang`: An object specifying the source language with `excelColumnName` (the column name in the CSV) and `deeplParamName` (the corresponding Deepl language code).
- `targetLangs`: An array of objects specifying the target languages, each with `excelColumnName` and `deeplParamName`.
