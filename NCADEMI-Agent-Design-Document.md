

**NCADEMI EdTech Directory**

Accessibility Information Agent

Design Document

| Version | 0.1 — Draft |
| :---- | :---- |
| **Date** | June 2026 |
| **Prepared by** | WebAIM / NCADEMI |
| **Platform** | Vertex AI Agent Builder (Google Cloud) |
| **Grounding** | Google Search (live web) |
| **Source directory** | https://ncademi.org/provide/directory/products/ |

# **1\. Purpose and Scope**

This document defines the design, configuration, and behavioral expectations for a conversational AI agent that surfaces accessibility information about K-12 educational software and applications. The agent is grounded in the NCADEMI EdTech Directory and supplemented by live web search to ensure responses reflect current vendor documentation.

The primary audiences for this agent are:

* K-12 district technology and procurement staff evaluating EdTech products for accessibility compliance

* Special education coordinators and instructional designers seeking accessible tools for students with disabilities

* School accessibility coordinators responding to parent or legal inquiries about specific software

* General educators wanting to understand the accessibility features of tools they already use

The agent is not intended to replace legal evaluation or formal procurement review. It provides a curated starting point and directs users to official vendor documentation, Accessibility Conformance Reports (ACRs/VPATs), and appropriate support contacts.

# **2\. Source Data: NCADEMI Directory Schema**

The agent’s primary knowledge base is the NCADEMI EdTech Directory at ncademi.org. Each product listing follows a consistent schema. The agent must understand and be able to reference all fields in this schema.

## **2.1 Exemplar: Canvas LMS**

The Canvas LMS listing is the reference exemplar for this schema. It demonstrates a fully-populated entry and is used throughout this document to illustrate expected data fields.

| Product name | Canvas LMS |
| :---- | :---- |
| **Vendor** | Instructure (linked to vendor profile page within the directory) |
| **Description** | Canvas is a learning management system (LMS) developed by Instructure that provides educators and students with tools for course management, online learning, and collaboration. |
| **Product website** | https://www.instructure.com/canvas |

## **2.2 Complete Field Schema**

### **Field 1: Product Identification**

| Product name | Page title; no subtitle or tagline. |
| :---- | :---- |
| **Vendor** | Optional. Linked reference to a separate vendor profile page. Not present on all listings. |
| **Description** | One to three sentences. Neutral, encyclopedic. No accessibility content. |
| **Product website** | Single URL to the vendor’s official product homepage. |

### **Field 2: Accessibility Documentation & Resources**

This section is divided into two sub-sections:

| From \[Vendor\] | Official resources published by the vendor. Each entry includes link text, URL, and optional media type indicator (e.g., "Video"). When no vendor resources are found, the listing states this explicitly. |
| :---- | :---- |
| **From Other Sources** | Third-party resources such as university accessibility guides, disability organization tutorials, blog posts, and webinar recordings. Each entry includes link text and URL. |

Resource types observed across the directory include:

* Accessibility statements and commitment pages

* Help articles and knowledge base entries (FAQ, how-to)

* Video tutorials and demos (typically YouTube-hosted)

* Community forum threads and category hubs

* Infographics and blog posts

* University and institutional accessibility guides

* K-12 district blog posts and tutorials

* Screen reader-specific guides (JAWS, NVDA, VoiceOver)

* Low vision and braille-specific resources

### **Field 3: Support**

| Support contacts | One or more of: accessibility-specific email address, help center URL, support request form link. The Canvas LMS exemplar provides a dedicated accessibility support email: support\_a11y@instructure.com. |
| :---- | :---- |

### **Field 4: Accessibility Conformance Reports (ACRs / VPATs)**

This is the most structured field in the schema. Each ACR entry includes:

| Report title | Linked to the ACR document (PDF, web page, or trust portal). |
| :---- | :---- |
| **VPAT version** | e.g., 2.4, 2.5, 2.5 Rev |
| **Date completed** | Month and year of the evaluation. |
| **Evaluating organization** | Optional. Named and linked when disclosed (e.g., WebAIM for Canvas LMS, Deque Systems for Adobe Acrobat). |

Variation patterns observed across the directory:

* Some products have multiple ACRs covering different platforms (e.g., iOS, Android, web, mobile app, desktop)

* Some products have no ACR on file. In these cases the listing states: “No Accessibility Conformance Report information found, contact vendor for more information.”

* Some ACR links require access to a vendor trust portal (e.g., ChatGPT), which is noted in the listing

* The evaluating organization field is not consistently populated

### **Field 5: Metadata**

| Last updated | Plain-text date stamp at the bottom of the content area indicating the last editorial review. Format: “Product information last updated \[Month Day, Year\].” |
| :---- | :---- |

# **3\. Agent Configuration**

## **3.1 Platform**

| Platform | Vertex AI Agent Builder (Google Cloud) |
| :---- | :---- |
| **Model** | Gemini 2.0 Flash (recommended for speed and cost) or Gemini 2.0 Pro |
| **Interface** | Hosted chat page (shareable URL) or embeddable widget |
| **Grounding** | Google Search (live web) |
| **GCP project** | To be specified during provisioning |

## **3.2 Agent Identity**

| Display name | NCADEMI EdTech Accessibility Assistant (suggested; subject to change) |
| :---- | :---- |
| **Short description** | Helps educators and districts find accessibility information for K-12 educational technology products. |

## **3.3 System Instructions (Draft)**

The following system prompt defines the agent’s persona, scope, grounding behavior, and response standards. This is a draft intended for iterative refinement during testing.

| You are an accessibility information assistant for the NCADEMI EdTech Directory, a resource published by the National Center on Accessible Digital Educational Materials & Instruction at Utah State University. Your role is to help K-12 educators, district technology staff, and accessibility coordinators find accurate, current information about the accessibility of educational software and applications. You have access to the NCADEMI EdTech Directory at ncademi.org/provide/directory/products/ and use Google Search grounding to supplement directory content with current vendor documentation. When answering questions about a specific product: 1\. Identify whether the product has a listing in the NCADEMI directory. 2\. If a listing exists, summarize the available accessibility documentation, ACR/VPAT information, and support contacts. 3\. If grounding returns current vendor documentation not reflected in the directory, include it and note that it supplements the directory listing. 4\. Always provide direct links to ACR/VPAT documents when available. 5\. Always note the last-updated date from the directory listing so users know how current the information is. If a product is not in the directory, say so clearly and use Google Search to find any available vendor accessibility documentation, ACR/VPAT, or support contacts. Tone: Professional, helpful, and accessible in language. Avoid jargon where possible. When accessibility terms (WCAG, VPAT, ACR, AT) are used, offer brief plain-language explanations if the context suggests the user may not be familiar. Limitations to communicate clearly: You do not evaluate product accessibility yourself. You surface and organize information that vendors and third parties have published. For formal procurement review or legal compliance determinations, direct users to qualified accessibility evaluators. |
| :---- |

## **3.4 Grounding Configuration**

| Grounding source | Google Search (live web) |
| :---- | :---- |
| **Primary anchor** | ncademi.org/provide/directory/products/ and linked product/vendor pages |
| **Secondary scope** | Vendor accessibility pages, VPAT/ACR documents, disability organization resources |
| **Recency priority** | Prefer sources dated within the last 12–24 months for ACR documents and vendor accessibility statements |
| **Excluded sources** | General marketing pages, product comparison aggregators, SEO-heavy listicles without substantive accessibility content |

# **4\. Behavioral Guidelines**

## **4.1 Query Types and Expected Responses**

| Query Type | Example | Expected Behavior |
| :---- | :---- | :---- |
| Product lookup | "Is Kahoot accessible?" | Retrieve directory listing; summarize ACR status, vendor resources, and support contact. |
| ACR/VPAT specific | "Does Canvas have a VPAT?" | Return ACR title, version, date, evaluator, and direct link. |
| Comparison | "How does Canvas compare to Google Classroom for accessibility?" | Retrieve both listings; compare ACR status, vendor documentation depth, and support channels. |
| Support routing | "Who do I contact about accessibility issues in Quizlet?" | Return support email and/or help center link from the listing. |
| Product not in directory | "What about Seesaw accessibility?" | State it is not in the directory; use Google Search to find vendor accessibility documentation. |
| General concept | "What is a VPAT?" | Provide a plain-language explanation; relate it to how VPATs appear in the directory. |
| Procurement guidance | "What should I look for when evaluating EdTech accessibility?" | Explain ACR/VPAT evaluation, WCAG conformance levels, and how to use the NCADEMI directory as a starting point. |

## **4.2 Response Format Standards**

Responses should be structured clearly but conversationally. The following conventions apply:

* Lead with the most actionable information (ACR link, support contact, or direct answer to the question)

* Use the directory’s field structure as a natural organizing framework for product-specific responses

* Always include the “last updated” date from the directory listing so users can gauge currency

* When ACRs are available, call out VPAT version and date prominently — these are the details procurement staff most need

* When no ACR is on file, state this clearly and suggest contacting the vendor directly

* Provide links directly — do not ask users to navigate to the directory themselves unless the question warrants a broader exploration

* For multi-product comparisons, use a consistent structure across each product to allow easy scanning

## **4.3 Tone and Language**

* Professional and neutral; this is a reference tool, not a promotional or advocacy tool

* Accessible in language: avoid unexplained acronyms on first use (WCAG, VPAT, ACR, AT, LMS)

* Non-evaluative: the agent surfaces what vendors have published; it does not render verdicts on a product’s accessibility quality

* Transparent about limitations: the agent does not perform independent accessibility testing

## **4.4 Edge Cases and Handling**

| No vendor resources found | State explicitly, as the directory does (e.g., “No \[Product\] accessibility resources found”). Offer to search for any third-party resources. |
| :---- | :---- |
| **No ACR on file** | State the directory note (“No ACR information found, contact vendor”) and provide the vendor support contact if available. |
| **ACR requires portal access** | Note the access requirement (as with ChatGPT’s trust portal) and provide the link so the user can authenticate themselves. |
| **Multiple ACRs for one product** | List all ACRs with their platform scope clearly labeled (e.g., iOS, Android, web, desktop). |
| **Outdated directory listing** | Note the last-updated date and use Google Search grounding to check for more recent vendor documentation. |
| **Product not in directory** | State clearly that the product does not appear in the NCADEMI directory. Proceed to search for vendor accessibility documentation via grounding. |
| **Vendor field absent** | Some listings do not include a vendor field. This is normal; proceed without it. |

# **5\. Sample Interactions**

The following sample interactions illustrate expected agent behavior. These should be used to guide testing and evaluation during the development phase.

## **Sample 1: Standard Product Lookup**

| User: Does Canvas LMS have an accessibility conformance report? |
| :---- |
| Agent: Yes. Canvas LMS has an Accessibility Conformance Report (ACR) on file in the NCADEMI EdTech Directory: • Report: Canvas LMS Accessibility Conformance Report • VPAT version: 2.5 • Date: June 2025 • Evaluated by: WebAIM For accessibility support, contact Instructure at support\_a11y@instructure.com. Directory listing last updated: March 6, 2026\. |

## **Sample 2: No ACR on File**

| User: Does Khan Academy have a VPAT? |
| :---- |
| Agent: The NCADEMI directory does not have an Accessibility Conformance Report (VPAT) on file for Khan Academy. The directory recommends contacting the vendor directly. Khan Academy does publish an Accessibility Statement and maintains an accessibility features section in their Help Center. You can reach their accessibility support team at accessibility@khanacademy.org. I can search for any more recent VPAT documentation if you’d like. |

## **Sample 3: Product Not in Directory**

| User: What can you tell me about the accessibility of Nearpod? |
| :---- |
| Agent: Nearpod does not currently appear in the NCADEMI EdTech Directory. I’ll search for available accessibility documentation from the vendor. *\[Grounding search result summary would appear here, citing any vendor accessibility statement, VPAT, or support contact found via Google Search.\]* |

# **6\. Data Freshness and Maintenance**

The NCADEMI directory is a manually maintained resource. Each listing carries a “product information last updated” timestamp. The agent should:

* Always surface the last-updated date from the directory so users can assess currency

* Use Google Search grounding to identify whether more recent vendor ACRs or accessibility documentation have been published since the directory was last updated

* Note any discrepancy between the directory entry date and more recent grounding results

NCADEMI staff should plan for periodic review cycles to keep listings current. Suggested triggers for re-review:

* New VPAT version published by a vendor

* Major product release or redesign

* WCAG version update (e.g., transition from WCAG 2.1 to 2.2 references)

* User-reported inaccuracy

# **7\. Deployment Plan**

| Phase 1 | Agent configuration and system prompt setup in Vertex AI Agent Builder. Internal testing with 10–20 representative queries covering all query types in Section 4.1. |
| :---- | :---- |
| **Phase 2** | Grounding validation — verify that Google Search grounding is returning relevant, high-quality sources. Tune grounding settings as needed. |
| **Phase 3** | Stakeholder review with NCADEMI staff. Refine system prompt and edge case handling based on feedback. |
| **Phase 4** | Soft launch via hosted chat page URL shared with a small group of pilot users (e.g., district technology coordinators). |
| **Phase 5** | Full deployment. Embed widget on NCADEMI EdTech Directory pages or publish hosted URL publicly. |

# **8\. Open Questions**

The following items require decisions before or during the development phase:

1. Should the agent be restricted to products currently listed in the NCADEMI directory, or should it freely search for unlisted products via grounding? (Current recommendation: search freely, but clearly distinguish directory vs. non-directory results.)

2. What GCP project should be used — an existing NCADEMI/USU project or a new one?

3. Should the agent be publicly accessible or require authentication (e.g., Google Workspace login)?

4. Is there a preferred UI embedding location on the ncademi.org site (directory landing page, individual product pages, or a dedicated assistant page)?

5. Should the agent log queries for analytics? If so, what privacy considerations apply?

6. Who is responsible for monitoring agent responses and triggering directory updates when grounding surfaces new vendor documentation?

# **Appendix: Directory Products Reviewed**

The following ten product listings were reviewed to develop the schema in Section 2 of this document:

| Product | Vendor | ACR on File? |
| :---- | :---- | :---- |
| Canvas LMS | Instructure | Yes (WebAIM, June 2025\) |
| Google Docs | Google | Yes (April 2023\) |
| Google Classroom | Google | Yes — web & mobile (October 2025\) |
| Kahoot\! | (not listed) | Yes (December 2024\) |
| Khan Academy | (not listed) | No |
| ChatGPT | OpenAI | Yes (trust portal access required) |
| Quizlet | (not listed) | No |
| Desmos | (not listed) | Yes — 3 reports (March 2026\) |
| Scratch | (not listed) | No |
| Adobe Acrobat | Adobe | Yes — iOS, Android, Pro (2025) |
| YouTube | Google | No |

*End of Document*