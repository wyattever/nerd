# Vendor Audit — published-tables.json

Source: `frontend/lib/published-tables.json` (60 products total)
Schema: `frontend/lib/published-tables.ts` (`PublishedProductRecord`)

**Resource key** (the "From [Vendor]" list on each product record):
`vendor_resources`

## Unique vendors (14)

- **A+E Global Media** — https://ncademi.org/provide/directory/vendors/ae-global-media/
- **Adobe** — https://ncademi.org/provide/directory/vendors/adobe/
- **Amplify** — https://ncademi.org/provide/directory/vendors/amplify/
- **BrainPOP** — https://ncademi.org/provide/directory/vendors/brainpop/
- **Curriculum Associates** — https://ncademi.org/provide/directory/vendors/curriculum-associates/
- **Google** — https://ncademi.org/provide/directory/vendors/google/
- **IXL Learning** — https://ncademi.org/provide/directory/vendors/ixl-learning/
- **Instructure** — https://ncademi.org/provide/directory/vendors/instructure/
- **Kami** — https://ncademi.org/provide/directory/vendors/kami/
- **McGraw Hill** — https://ncademi.org/provide/directory/vendors/mcgraw-hill/
- **Microsoft** — https://ncademi.org/provide/directory/vendors/microsoft/
- **PowerSchool** — https://ncademi.org/provide/directory/vendors/powerschool/
- **Teaching.com** — https://ncademi.org/provide/directory/vendors/teaching-com/
- **edclub** — https://ncademi.org/provide/directory/vendors/edclub/

## Products with no vendor on record (26)

`vendor_name` is `null` for these 26 products — `vendor_name` and `vendor_directory_url` are typed
as `string | null`, so this is a valid (if incomplete) state per the schema, not a data error:

99math, blooket, bookflix, brainingcamp, brainly, canva, chatgpt, code-org, coolmathgames, desmos,
edpuzzle, encyclopedia-britannica, epic, gimkit, kahoot, kami, math-playground, pbs,
phet-interactive, prodigy, quizlet, scratch, study-com, wayground, weebly, khan-academy
