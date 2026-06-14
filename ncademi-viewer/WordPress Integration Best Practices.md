# **WordPress Integration & HTML Extraction Guide**

## **The Challenge**

The N.E.R.D. application has two conflicting requirements for its HTML output:

1. **The Live Preview Requirement:** The Next.js frontend must display a 100% visually accurate preview of what the product listing will look like on the live NCADEMI site. This requires a full HTML document (\<html\>, \<head\>, \<body\>) with links to the live WordPress CSS stylesheets.  
2. **The WordPress Editor Requirement:** When a user copies the output to update the live site, they cannot paste a full HTML document into the WordPress editor (Gutenberg/Classic). Doing so will break the site layout, as WordPress expects only inner, semantic content elements (\<h2\>, \<ul\>, \<p\>).

## **The Solution: "Full Preview, Partial Extraction"**

To satisfy both requirements, the system should always generate and serve the **full HTML document**, but the frontend will dynamically parse and extract **only the required semantic HTML** right before copying it to the clipboard.

### **Step 1: Backend Generation (Full Document)**

Your FastAPI /render endpoint (via nerd\_core.generators.render\_listing\_html) must continue to generate the complete HTML shell.

This includes:

* The \<\!DOCTYPE html\> declaration.  
* The \<head\> with \<link\> tags pointing to ncademitheme/style.css.  
* The \<body\> and structural wrappers (e.g., \<main\>, \<article\>, \<div class="entry-content"\>).

### **Step 2: Live Preview (Full Document)**

In the Next.js frontend, feed this complete, unadulterated HTML string directly into the srcDoc attribute of your isolated \<iframe\>. Because the iframe acts as an independent browser window, it will load the external CSS and render the page with perfect visual fidelity.

### **Step 3: Targeted HTML Extraction (The Clipboard Logic)**

When the user clicks **"Copy HTML"**, the frontend must intercept the full HTML string, parse it, and extract *only* the contents of the main WordPress text area.

Here is the exact React/JavaScript logic to implement this using the native DOMParser API:

/\*\*  
 \* Extracts clean, semantic HTML from a full HTML document string  
 \* and copies it to the user's clipboard.  
 \* \* @param {string} fullHtmlString \- The complete HTML document returned by the API  
 \*/  
const copyWordpressReadyHtml \= async (fullHtmlString) \=\> {  
  try {  
    // 1\. Parse the raw HTML string into a queryable DOM object  
    const parser \= new DOMParser();  
    const doc \= parser.parseFromString(fullHtmlString, 'text/html');

    // 2\. Target the specific wrapper used by the NCADEMI WordPress theme.  
    // Fallback to \<main\> or \<body\> if the specific class isn't found.  
    const targetNode \= doc.querySelector('.entry-content')   
                    || doc.querySelector('main')   
                    || doc.body;

    if (\!targetNode) {  
      throw new Error("Could not locate the primary content container.");  
    }

    // 3\. Extract ONLY the inner HTML (semantic content, no shell tags)  
    // We trim to remove unnecessary leading/trailing whitespace  
    const cleanHtml \= targetNode.innerHTML.trim();

    // 4\. Write to the clipboard  
    // Note: navigator.clipboard requires a secure context (HTTPS or localhost)  
    await navigator.clipboard.writeText(cleanHtml);  
      
    alert("WordPress-ready HTML copied to clipboard\!");

  } catch (error) {  
    console.error("Failed to extract and copy HTML:", error);  
      
    // Fallback for older browsers or insecure iframe contexts  
    // using document.execCommand  
    fallbackCopyTextToClipboard(fullHtmlString);   
  }  
};

## **Why This is the Best Practice**

* **Zero Backend Complexity:** The backend doesn't need separate endpoints for "preview HTML" and "export HTML". It serves one source of truth.  
* **Failsafe Testing:** Automated tests (like Phase 5 verify\_cutover.py) can continue to perform byte-fidelity diffs on the entire document structure, ensuring no legacy wrappers are accidentally broken over time.  
* **Gutenberg Compatibility:** By extracting just the innerHTML of the .entry-content div, the resulting clipboard data is pure, semantic HTML. When pasted into the WordPress Block Editor, WordPress will automatically convert those \<h2\>, \<ul\>, and \<p\> tags into native, editable WordPress blocks.