# Local MVP Data

## BSE Price and Corporate-News Archive

- Dataset: [Indian Stock Market Dataset](https://www.kaggle.com/datasets/adritpal08/indian-stock-market-dataset), Kaggle owner `adritpal08`.
- Kaggle lists the dataset license as CC0: Public Domain. The contributor describes the data as collected from the BSE website using `bsedata`/`bselib`.
- Downloaded on 2026-09-30. The source dataset's latest version is dated 2023-05-26; it is historical seed data, not a live feed.
- The original archive is `indian-stock-market-dataset.zip`; the extracted source files are kept in `indian-stock-market-dataset/`.
- The local importer reads `active_companies_list.csv`, `period_trend_data_12M.csv`, and `corporate_news_data.csv`.
- The importer catalogs 99 BSE companies from the source's active-company list. It currently imports 24,416 daily close/volume rows and 333 linked corporate-news records; all 12 portfolio symbols are covered. Rows are mapped through `ScripCode`/`SecurityID`.
- Price rows cover 2022-05-26 through 2023-05-26 and contain close and volume only. Open/high/low values are absent and are not synthesized.
- News publication dates in the source span 2017-11-06 through 2023-05-26. The app stores headline/title, publisher domain, publication time, and source link only; it does not store full article bodies or infer source credibility. Its optional experimental sentiment is a transparent title-only weighted wordlist, and headlines without recognized cues remain unscored.
- The Kaggle dataset license applies to the dataset as distributed. Publisher terms may still apply to linked headlines and pages; the app links to the publisher/source URL and does not reproduce article text.

To re-import into the local D1 database, start the local Worker and run `corepack pnpm --dir backend import:market-data` from the workspace root.