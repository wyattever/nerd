# **NCADEMI Ingestion Assistant: Golden Set (Evaluation)**

This document tracks "Ground Truth" data for representative EdTech products. Use these to verify the Agent's accuracy and tune the system prompt.

---

## **Category 1: The Gold Standard (Well-documented)**
**Product:** Canvas LMS
**URL:** https://www.instructure.com/canvas
**Ground Truth:**
*   **Vendor:** Instructure
*   **ACR Status:** Available (WebAIM evaluated)
*   **ACR Version:** 2.5
*   **Support:** dedicated a11y email (`support_a11y@instructure.com`)

---

## **Category 2: The "Trust Portal" (Gated)**
**Product:** ChatGPT (OpenAI)
**URL:** https://chatgpt.com/
**Ground Truth:**
*   **ACR Status:** Behind Trust Portal (OpenAI Trust & Security)
*   **Expected Agent Behavior:** Must NOT hallucinate ACR details. Must provide the link to the Trust Portal and note that access is required.

---

## **Category 3: No ACR on File**
**Product:** Khan Academy
**URL:** https://www.khanacademy.org/
**Ground Truth:**
*   **ACR Status:** Not found / None published.
*   **Expected Agent Behavior:** State clearly that no ACR was found and point to the general Accessibility Statement and support email.

---

## **Category 4: Multiple Reports (Platform Specific)**
**Product:** Adobe Acrobat
**URL:** https://www.adobe.com/acrobat.html
**Ground Truth:**
*   **ACR Status:** Multiple (Pro, Reader, Web, Mobile).
*   **Expected Agent Behavior:** Should ideally list or summarize that multiple reports exist for different platforms.

---

## **Category 5: The "Hidden Vendor" (Hard)**
**Product:** Nitro Type
**URL:** https://www.nitrotype.com/
**Ground Truth:**
*   **Vendor:** Teaching.com
*   **ACR Status:** No product-specific ACR for Nitro Type, but Teaching.com / Typing.com has an ACR.
*   **Expected Agent Behavior:** Identify Teaching.com as the vendor and link to their central accessibility page if Nitro Type specific docs are missing.

---

## **Category 6: The "Missing" ACR (Edge Case)**
**Product:** Mathway
**URL:** https://www.mathway.com/
**Ground Truth:**
*   **Vendor:** Chegg
*   **ACR Status:** No public ACR.
*   **Expected Agent Behavior:** Report "No ACR found" clearly. Point to Chegg's accessibility commitment.

---

## **Category 7: The "Open Source" Challenge**
**Product:** CK-12
**URL:** https://www.ck12.org/
**Ground Truth:**
*   **ACR Status:** Often embedded in help articles/FAQs rather than a formal ACR doc.
*   **Expected Agent Behavior:** Scour the Help Center for accessibility features and support contacts.

---

## **Evaluation Checklist for Prompt Tuning**
1.  **Hallucination Check:** Does the agent "invent" a VPAT version or date when none is found?
2.  **Public-Only Filter:** Did the agent try to link to a resource that required a login?
3.  **Schema Adherence:** Is the Markdown formatting exactly as requested?
4.  **Description Tone:** Is the description neutral/encyclopedic (no marketing fluff)?
