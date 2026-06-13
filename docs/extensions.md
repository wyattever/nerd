# NCADEMI Research Assistant: Planned Extensions

## Persistent Directory Storage ("The Repo")

This extension enables the application to store high-quality research results in a persistent database (BigQuery) to reduce API costs and provide near-instant results for previously researched products.

### 1. Workflow: Saving a New Listing
- **Trigger**: A new button labeled **"Save to Repo"** appears below a generated listing.
- **Action**: When clicked, the current markdown result, the product name, and the source URL are stored in a `directory_listings` table.
- **Metadata**: Each record includes a `created_at` timestamp and the `user_id` (if authenticated).

### 2. Workflow: Retrieval & Discovery
- **Logic**: When a user enters a Product URL and hits "Generate", the app first performs a lookup:
  ```sql
  SELECT refined_markdown, created_at 
  FROM telemetry.directory_listings 
  WHERE normalized_url = [input_url]
  LIMIT 1
  ```
- **UI State (Found)**:
    - If a match is found, the app skips the Gemini research phase.
    - **Display**: The saved markdown is rendered immediately.
    - **Alert**: A message is displayed: *"A listing created on [Date] was found in the NCADEMI repository."*
    - **Option**: A **"Run New Search"** button is provided to allow the user to check for more recent data.

### 3. Workflow: Updating an Existing Listing
- **Trigger**: If the user clicks "Run New Search" on a product that already exists in the repo, the Gemini research process runs as normal.
- **Comparison**: Once the new results are displayed, a button labeled **"Update Repo"** is shown.
- **Action**: Clicking "Update Repo" overwrites the existing record for that URL with the new markdown and updates the `created_at` timestamp.
- **Confirmation**: A notification confirms: *"Listing updated successfully."*

### 4. Technical Considerations
- **URL Normalization**: Before lookup or storage, URLs should be stripped of protocols (`http/https`), trailing slashes, and common tracking parameters to ensure `kahoot.com/` matches `https://www.kahoot.com`.
- **Database Schema**:
  | Column | Type | Description |
  | :--- | :--- | :--- |
  | `product_id` | STRING (UUID) | Unique identifier |
  | `url_hash` | STRING | Normalized URL hash for fast indexing |
  | `original_url` | STRING | The exact URL entered by the user |
  | `product_name` | STRING | Extracted product name |
  | `content_md` | STRING | The full markdown of the listing |
  | `created_at` | TIMESTAMP | Entry/Update date |
- **BigQuery Setup**: This requires a new table `telemetry.directory_listings` with the schema above.
