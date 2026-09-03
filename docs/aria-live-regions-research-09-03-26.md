# **Dynamics of WAI-ARIA Live Regions in Streaming Web Applications**

The implementation of dynamically updated web interfaces—particularly those streaming continuous progress updates over extended durations—presents profound challenges for assistive technology compatibility and specification adherence. Under the Web Content Accessibility Guidelines (WCAG) 2.2, Success Criterion (SC) 4.1.3: Status Messages dictates that changes in content conveying status must be programmatically determinable without receiving keyboard focus, thereby enabling assistive technologies to announce them seamlessly. Fulfilling this criterion for a desktop web application that streams sequential progress lines alongside terminal success and error states relies exclusively on the Accessible Rich Internet Applications (WAI-ARIA) live region specification.  
Analysis of empirical testing data spanning recent browser and screen reader iterations reveals a complex, fragmented landscape where the W3C specification frequently diverges from real-world assistive technology behavior. The following report details the documented mechanics, empirical test results, and systemic failure modes of WAI-ARIA live regions applied to streaming-progress interfaces, structured specifically to evaluate architectural decisions prior to implementation.

## **1\. DOM Mutation Mechanics and Assistive Technology Behaviors**

The fundamental mechanism of an ARIA live region relies on the browser's accessibility API monitoring specific Document Object Model (DOM) nodes for mutations and subsequently transmitting those mutations to a screen reader's announcement queue. The method by which the DOM is updated—whether by mutating existing children in place, replacing text content, or appending new child nodes—has heavily documented impacts on how updates are announced. Furthermore, the timing of the live region's existence within the DOM dictates whether the accessibility API registers the update at all.

### **Container Injection versus In-Place Modification**

Testing consistently demonstrates that dynamically injecting a new live region container into the DOM simultaneously with its text content is the least robust method for triggering an announcement. When a container element bearing a live region attribute (such as aria-live="polite") or role (such as role="status") is injected into the document at the exact moment the status updates, or when an existing container is toggled from a hidden state (e.g., via CSS display: none or hidden attributes), the node does not yet exist in the browser's accessibility tree at the precise millisecond the mutation event fires1. Consequently, the screen reader fails to register the update, resulting in silence.  
The documented, robust approach requires an empty live region container to exist statically within the DOM upon page load. Text nodes or child elements are subsequently appended or mutated within this established container1. A common implementation error occurs when both the container and its content are injected in a single operation; many screen readers only detect mutations on containers that already exist in the DOM2.

### **Mutating Children vs. Replacing Text vs. Appending Nodes**

When an established, static live region container is modified, the nature of the DOM mutation alters the screen reader's response based on the aria-atomic property of the region.

> 1. **Appending New Child Nodes:** When a new element (such as a list item or a span containing a status line) is appended to the live region, the default behavior (when aria-atomic is false) dictates that only the newly added node is announced2. This is the intended behavior for streaming logs where users only need to hear the latest update.  
> 2. **Replacing Text Content:** If the entire text content of a live region is replaced (e.g., setting the innerHTML or textContent of a span to a new string), the screen reader treats this as a complete node replacement and reads the new string. However, testing notes a specific failure mode: if the new text string is identical to the previous text string, screen reader heuristics often interpret this as a non-event and remain silent3. To force an announcement when replacing text with similar or identical content, practitioners document that setting the content briefly to an empty string before inserting the new text forces the accessibility API to recognize a fresh change4.  
> 3. **Mutating Children in Place:** If a child node within a larger live region is mutated in place, the screen reader's behavior is dictated entirely by the container's atomic state. If atomic is true, the entire region is read; if false, only the mutated string is read2.

### **Screen Reader and Browser Pairings**

The behavior of live region mutations varies significantly across major desktop browser and screen reader combinations. It is critical to note that screen reader behavior changes across versions, and stale results are actively misleading. The following matrix details the documented behaviors based on empirical testing conducted between 2023 and 2026 by Adrian Roselli (http://adrianroselli.com/2026/01/live-region-support.html)7.  
*Note: Documented evidence for VoiceOver on macOS specifically paired with Chrome or Firefox is absent from the provided research corpus; therefore, VoiceOver findings are strictly limited to its behavior within Safari, and generalization to other browsers is not possible.*

| Screen Reader & OS | Browser & Version | Polite Region Behavior (Mutations & Appends) | Hidden Region Behavior | Dynamic Node Adjustments |
| :---- | :---- | :---- | :---- | :---- |
| **NVDA 2025.3.2 (Windows)** | Firefox 146.0.1 | Treated as polite; waits for the first visual break (not necessarily the end of a sentence) before announcing. | No announcement when hidden. | Dynamic description nodes do not announce. |
| **NVDA 2024.1 (Windows)** | Firefox 126 | Treated as polite; waits for the first visual break before announcing. | No announcement when hidden. | \- |
| **NVDA 2023.1 (Windows)** | Firefox 114 | Treated as polite; appends are announced sequentially. | No announcement when hidden. | \- |
| **JAWS 2026.2512 (Windows)** | Chrome 144.0 | Treated as polite; waits for the first visual break before announcing. | No announcement when hidden. | Dynamic description changes do not announce in version 144\. |
| **JAWS 2026.2512 (Windows)** | Chrome 143.0 | Treated as polite; waits for the first visual break before announcing. | No announcement when hidden. | Dynamic description changes successfully announce. |
| **JAWS 2023.2306 (Windows)** | Chrome 114 | Treated as polite; waits for the first visual break before announcing. | No announcement when hidden. | \- |
| **VoiceOver (macOS 26.0)** | Safari 26.0 | Not announced during a read-all command; acts as assertive on Braille displays, resulting in lost content. | No announcement when hidden. | Dynamic descriptions do not announce. |
| **VoiceOver (macOS 12.6)** | Safari 16.5 | Not announced during a read-all command; acts as assertive on Braille displays, resulting in lost content. | No announcement when hidden. | Fails to announce injected regions reliably unless container is static. |

The testing establishes a universal constant: hiding a live region through CSS display properties (display: none) or ARIA hidden attributes completely removes it from the accessibility tree, reliably suppressing all announcements across all tested pairings7.

## **2\. Semantic Live Regions: Roles and Properties in Practice**

The ARIA specification provides explicit roles and properties to manage live regions. For an append-style progress feed, developers typically evaluate role="log", role="status", or a generic container with aria-live="polite". However, profound systemic discrepancies exist between the theoretical specification of these attributes and the functional reality of screen reader implementations.

### **Role Log versus Role Status**

For a streaming feed where short status lines are appended sequentially, both the log and status roles appear technically applicable, but they possess divergent implicit properties that drastically alter the auditory experience.  
The role="log" is defined by the W3C as a type of live region where new information is added in a meaningful order and old information may disappear, such as a chat log, messaging history, or an error console8. Elements with this role carry an implicit politeness setting of polite, an implicit aria-atomic setting of false, and an implicit aria-relevant setting of additions10. Because its implicit atomic state is false, appending a new child node to a log region theoretically prompts the screen reader to announce only the newly appended node, preserving the linear reading flow of a progress feed without repeating historical data2. A11ysupport.io testing confirms that screen readers *must* convey the implicit polite value by not interrupting the current announcement, and *must* convey the implicit atomic value of false by only announcing changed content10.  
Conversely, the role="status" is intended for advisory information that is not critical enough to justify an alert9. Elements with the status role also possess an implicit polite setting, but crucially, their implicit aria-atomic value is true11. Therefore, mutating a status region theoretically triggers the screen reader to announce the entire contents of the region upon every update12. In a streaming application, if ten progress lines have been appended, the addition of the eleventh line would cause a screen reader interpreting role="status" perfectly to re-read lines one through eleven, creating an intolerable user experience.  
Despite these implicit definitions, empirical testing reveals that relying solely on the implicit properties of semantic roles is highly unreliable. Screen reader and browser pairings frequently fail to honor implicit atomic or polite states derived purely from a role. Consequently, exhaustive testing by accessibility practitioners dictates that developers must redundantly declare explicit ARIA properties (e.g., manually adding aria-live="polite" and aria-atomic="false") on these semantic roles to force uniform behavior across the software ecosystem6.

### **The Granularity of Atomic Updates**

The aria-atomic property dictates the exact payload of the speech instruction sent to the synthesizer.

* **aria-atomic="true":** The screen reader announces the entire contents of the live region when any change happens inside of it, regardless of what specifically changed. It announces the full content plus the region's accessible name2. This is strictly necessary when updating a single variable within a sentence (e.g., updating a time from "17:34" to "17:35"), where reading just the changed numbers would lack context12.  
* **aria-atomic="false":** The screen reader should only announce the parts of the element that have changed (added or removed nodes). This is the default value12. This setting is mandatory for appending content asynchronously, such as adding items to a list or a progress feed, to prevent exhaustive repetition of prior content16.

### **The Illusion of Relevant Mutations and Divergence from Spec**

The aria-relevant attribute was engineered to allow authors to specify which types of DOM mutations trigger announcements: additions, removals, text, or all12. By default, live regions monitor for additions text, meaning new nodes and text changes trigger announcements2.  
The W3C originally added aria-relevant to the specification under the theoretical premise that a screen reader could receive hints that content being removed from a web page should be announced to the user (e.g., if a user is removed from an online roster)15. To achieve this, an author would set aria-relevant="removals" or aria-relevant="all".  
However, the gap between the specification and observed behavior regarding aria-relevant is absolute. Extensive testing across the ecosystem demonstrates that the removals token is functionally broken and rarely works as intended17.

* **VoiceOver (macOS) and NVDA (Windows):** According to testing by Scott O'Hara (https://medium.com/dev-channel/why-authors-should-avoid-aria-relevant-5d3164fab1e3), these screen readers systematically ignore the removals directive and will not announce anything when content is removed, even when explicitly instructed by the attribute17.  
* **JAWS (Windows):** JAWS will attempt to announce the removal by speaking the text followed by the word "removed," but only if the author removes a *descendant* of the live region. If the live region node itself is removed, JAWS remains silent17.

Due to these severe implementation failures, the attribute lacks a real-world use case. The documented consensus among accessibility researchers and practitioners is to completely avoid utilizing aria-relevant and rely exclusively on standard additions text announcements17.

## **3\. The Two-Region Pattern: Empirical Testing and Efficacy**

When developing complex desktop web applications, authors frequently encounter scenarios where the visual representation of a progress stream—such as deeply nested DOM structures, animated skeleton loaders, or stylized visual elements—causes screen reader heuristics to misinterpret updates, read excess noise, or drop the announcements entirely. To circumvent the unreliability of binding live regions directly to complex visual DOM trees, accessibility practitioners utilize a two-region architecture: one region manages the visual DOM complexity for sighted users, while a separate, visually-hidden live region acts exclusively as an optimized text announcement channel for assistive technologies.

### **Tested Practice vs. Folk Remedy**

Analysis of published methodologies confirms that the two-region pattern is an empirically tested, highly robust standard practice within the accessibility engineering domain, not merely an anecdotal folk remedy4. By decoupling the visual markup from the accessibility tree's notification mechanics, developers secure absolute programmatic control over the exact string passed to the speech synthesizer.  
In this architecture, the visual interface is decorated with states indicating background activity (often utilizing aria-hidden="true" or generic markup to shield it from screen readers). Concurrently, a static, off-screen live region configured with aria-live="polite" and aria-atomic="true" exists invisibly in the DOM6. When a visual status line is appended to the screen, application scripts simultaneously inject a clean, concatenated text string specifically formatted for audio comprehension into the off-screen live region.

### **Documented Failure Modes of the Pattern**

While highly effective, testing exposes several critical failure modes that developers must mitigate when employing the two-region pattern:

> 1. **Improper Hiding Mechanisms:** As established in Section 1, if the dedicated off-screen region is hidden via standard display properties (display: none) or ARIA attributes (aria-hidden="true"), it is purged from the accessibility tree, rendering it entirely silent7. The container must utilize specific CSS clipping techniques (often referred to as .sr-only or .visually-hidden classes) that preserve the node's dimensions and presence in the accessibility tree without rendering it visually on the screen4.  
> 2. **Identical String Suppression (Race Conditions):** If a progress stream attempts to output the exact same status line twice consecutively into the hidden region (e.g., "Processing batch..."), screen reader heuristics interpret the lack of a textual differential as a non-event, effectively dropping the second announcement. Tested workarounds documented by Adrian Roselli and Srikar Phani Kumar Marti involve programmatically clearing the live region (injecting an empty string) and instituting a minor timeout before injecting the subsequent identical string, forcing the API to register a mutation3.  
> 3. **Content Desynchronization:** If the hidden region's content diverges significantly from the visual text, or if the timing of the injection drifts from the visual render, it introduces profound cognitive dissonance. This is particularly detrimental for users who employ both visual and auditory processing, or sighted users utilizing screen readers for cognitive assistance.

## **4\. High-Velocity Data: Rapid Updates and Audio Queues**

A web application streaming progress updates over several minutes inherently risks producing status lines at a velocity that exceeds the physical limitations of a speech synthesizer. The disparity between instantaneous visual rendering speeds and linear auditory playback is a primary vector for live region failure.

### **Queueing, Dropping, and Interruptions**

The channel for speech delivery is limited to one message at any given time20. When a live region is set to polite, the screen reader does not immediately announce the change; instead, it sends a speech instruction to the operating system's synthesizer to be queued until the current audio output concludes and the user pauses their own navigation2.  
Testing indicates that when status messages arrive in rapid succession, the interaction between the browser, the screen reader's virtual buffer, and the OS synthesizer creates unpredictable behavior:

* **Queueing and Lag:** Screen readers will attempt to queue polite messages. However, if the frequency of updates consistently outpaces the duration of the spoken audio, the queue grows disproportionately. The user will continue hearing progress updates long after the visual interface has concluded its operation20.  
* **Batching and Dropping:** To prevent an overwhelming avalanche of delayed messages, screen readers employ internal change heuristics to batch rapid-fire changes4. In severe cases of high-velocity updates, the rendering of a speech instruction may be prematurely halted or dropped entirely from the virtual buffer so the software can catch up to the current state4.  
* **User Interruptions:** A user's own keyboard navigation, or the screen reader announcing a system message, can block or cancel queued messages entirely4.

### **Documented Guidance on Throttling**

Due to the fundamental limitations of single-channel audio delivery, published W3C guidance and practitioner research strictly advise against flooding live regions with rapid updates4. The W3C AT Driver issue tracker notes that screen readers may receive speech instructions from ARIA live regions in such rapid succession that no human user would ever perceive them20.  
While there is no universally prescribed millisecond interval mandated by the W3C for debouncing, researchers recommend explicit architectural mitigation:

* **Throttle or Debounce:** Developers are instructed to throttle or debounce live region injections at the application level4.  
* **Consolidated Messaging:** Rather than mirroring a high-frequency visual log one-to-one, applications should group related sequential updates and announce consolidated messages at natural operational thresholds (e.g., announcing progress every 10% or at major phase shifts)4.

Furthermore, developers relying on automated testing tools or speech viewer text logs to validate high-velocity regions must exercise extreme caution. According to testing by Adrian Roselli, text-based speech logs process queue instructions instantaneously, often displaying a perfect, un-dropped sequence of rapid announcements. In reality, the auditory experience will be heavily fragmented by queue limits and interruption heuristics. Relying exclusively on a text log for validation provides a dangerous false positive regarding the interface's actual accessibility22.

## **5\. Terminal States and Interruption Mechanics**

When a multi-minute streaming progress feed concludes, applications typically emit a terminal state—either a success confirmation or a critical error. For errors or critical workflow failures, the role="alert" is universally recommended. The alert role carries an implicit aria-live="assertive" property and an implicit aria-atomic="true" property, designed to interrupt the user and demand immediate attention2.

### **Reliability of the Assertive Interruption**

The critical operational question for developers of streaming interfaces is whether an alert triggered immediately after a long sequence of polite updates will reliably land, or if it will become lost behind a heavy queue of unprocessed, lagging progress lines.  
Empirical testing confirms that an assertive alert will reliably land and execute its primary function: it interrupts active announcements and forces its payload to the front of the queue2. A11ysupport.io testing confirms that screen readers *must* convey the implicit assertive value by interrupting the current announcement23.  
However, deep-dive testing across varying software environments reveals that the behavior of the screen reader *after* the assertive interruption varies dramatically by vendor, fundamentally altering the user experience. According to test data compiled between 2023 and 2026 (http://adrianroselli.com/2026/01/live-region-support.html):

* **NVDA (Firefox):** Across tested versions (2023.1 to 2025.3.2), NVDA treats the role="alert" as assertive, successfully interrupting the active announcement to deliver the terminal error. Crucially, NVDA possesses a recovery heuristic: after the assertive message concludes, it goes back and re-announces the polite content that it just interrupted7. Furthermore, NVDA consistently pre-pends the announcement with the explicit word "alert".  
* **JAWS (Chrome):** JAWS exhibits highly variable behavior. In versions 2023.2306 and 2026.2512 (Chrome 143/144), JAWS surprisingly treated the alert role as polite, waiting for the first visual break rather than strictly interrupting. Furthermore, JAWS does not pre-pend the announcement with the explicit word "alert", relying solely on the text string provided by the author7.  
* **VoiceOver (macOS Safari):** VoiceOver executes the assertive interruption as expected, halting the active announcement entirely. However, unlike NVDA, it *stops reading* and does not resume the prior polite queue7.

Because assertive regions aggressively hijack the audio channel and frequently destroy pending queues, accessibility experts strongly caution against their overuse. Assertive live regions (and by extension, the alert role) should never be used for standard progress updates. Doing so causes continuous, rapid-fire interruptions that routinely clip and destroy the user's ability to navigate the page, read static content, or comprehend standard focus announcements (e.g., hearing the accessible name of a newly focused form field)5. The assertive interruption must be strictly reserved for genuine, time-sensitive terminal errors.

## **6\. Conformance to WCAG 2.2 SC 4.1.3 (Status Messages)**

Success Criterion 4.1.3: Status Messages was introduced to address the specific usability barriers created by dynamic web applications. It exists to ensure that users who cannot visually monitor a page are informed of background state changes without being forced to divert their keyboard focus to the physical area where the change occurred25.

### **Normative Requirements**

The WCAG glossary defines a "status message" as a change in content that is not a change of context, and that provides information to the user on the success or results of an action, the waiting state of an application, the progress of a process, or the existence of errors25. A streaming-progress feed perfectly meets this definition.  
The normative requirement for SC 4.1.3 dictates that such status messages must be programmatically determinable through a role or property that an assistive technology can interpret and present, without the component receiving focus26. The application of appropriate ARIA live region semantics—such as the status or log roles, or explicit aria-live properties—fulfills this requirement by establishing the necessary programmatic hooks for the accessibility API.

### **Documented Failures in Streaming-Progress UIs**

Streaming-progress user interfaces frequently trip specific, documented failures regarding SC 4.1.3 conformance. Analysis of compliance data and WAI techniques reveals that applications commonly violate this criterion through the following architectural anti-patterns:

* **Focus Shifting:** The most severe failure occurs when an application attempts to alert the user to a terminal state or progress update by programmatically forcing keyboard focus to the status text. This violently disorients users, interrupts their current workflow, forces them to manually navigate back to their previous position, and directly violates the "without receiving focus" mandate of the criterion6.  
* **Dynamic Container Creation:** As detailed in Section 1, attempting to conform to the criterion by injecting the entire live region DOM node (container and text simultaneously) at the moment of the update constitutes a failure. Because the accessibility tree drops these sudden injections, the status message is never presented to the assistive technology, failing the requirement that the message be programmatically determinable1.  
* **Assertive Progress Updates:** Applying aria-live="assertive" or the role="alert" to the standard, non-critical progress stream. This causes continuous, rapid-fire interruptions that prevent the user from performing any other actions on the page while the process runs, constituting a severe usability barrier that runs contrary to the advisory nature of status messages5.  
* **Inappropriate Clearing of State:** Emptying the text of a status message container without hiding the container visually, which can cause screen readers to read a confusing "blank" announcement to the user, muddying the programmatic determination of the actual status5.

In summary, achieving conformance with SC 4.1.3 for a streaming UI requires a delicately balanced architecture. The evidence dictates that developers must utilize statically rendered, visually-hidden containers configured with explicit ARIA properties, throttle the injection of data to respect audio queue limitations, and reserve assertive interruptions strictly for terminal failures.

#### **Works cited**

> 1. Are we live? | scottohara.me, [https://www.scottohara.me/blog/2022/02/05/are-we-live.html](https://www.scottohara.me/blog/2022/02/05/are-we-live.html)  
> 2. What is ARIA Live Politeness Settings? · Rocket Validator Glossary, [https://rocketvalidator.com/glossary/aria-live-politeness-settings](https://rocketvalidator.com/glossary/aria-live-politeness-settings)  
> 3. Sortable Table Columns \- Adrian Roselli, [https://adrianroselli.com/2021/04/sortable-table-columns.html?Theme=Dark](https://adrianroselli.com/2021/04/sortable-table-columns.html?Theme=Dark)  
> 4. Screen Reader Handling of ARIA Live Regions \- DEV Community, [https://dev.to/mspk97/screen-reader-handling-of-aria-live-regions-timing-interruptions-and-debugging-404p](https://dev.to/mspk97/screen-reader-handling-of-aria-live-regions-timing-interruptions-and-debugging-404p)  
> 5. Live Regions \- UX Glossary Term | UX Patterns for Developers, [https://uxpatterns.dev/glossary/l/live-regions](https://uxpatterns.dev/glossary/l/live-regions)  
> 6. The Complete Guide to ARIA Live Regions for Developers, [https://www.a11y-collective.com/blog/aria-live/](https://www.a11y-collective.com/blog/aria-live/)  
> 7. Live Region Support \- Adrian Roselli, [http://adrianroselli.com/2026/01/live-region-support.html](http://adrianroselli.com/2026/01/live-region-support.html)  
> 8. WAI-ARIA: Role=Log \- DigitalA11Y, [https://www.digitala11y.com/log-role/](https://www.digitala11y.com/log-role/)  
> 9. Accessible Rich Internet Applications (WAI-ARIA) 1.2 \- W3C, [https://www.w3.org/TR/wai-aria-1.2/](https://www.w3.org/TR/wai-aria-1.2/)  
> 10. log role (aria) \- Accessibility Support, [https://a11ysupport.io/tech/aria/log\_role](https://a11ysupport.io/tech/aria/log_role)  
> 11. WAI-ARIA: Role=Status \- DigitalA11Y, [https://www.digitala11y.com/status-role/](https://www.digitala11y.com/status-role/)  
> 12. ARIA live regions \- MDN Web Docs \- Mozilla, [https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live\_regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions)  
> 13. status role (aria) \- Accessibility Support, [https://a11ysupport.io/tech/aria/status\_role](https://a11ysupport.io/tech/aria/status_role)  
> 14. Accessible notifications with ARIA Live Regions (Part 1), [https://www.sarasoueidan.com/blog/accessible-notifications-with-aria-live-regions-part-1/](https://www.sarasoueidan.com/blog/accessible-notifications-with-aria-live-regions-part-1/)  
> 15. What you need to know about ARIA live regions, [https://a11y-blog.dev/en/articles/aria-live-regions/](https://a11y-blog.dev/en/articles/aria-live-regions/)  
> 16. Accessibility in Web Applications with ARIA Live Regions \- Tim Wright, [https://timwright.org/posts/using-aria-live-regions/](https://timwright.org/posts/using-aria-live-regions/)  
> 17. Why authors should avoid aria-relevant \- Medium, [https://medium.com/dev-channel/why-authors-should-avoid-aria-relevant-5d3164fab1e3](https://medium.com/dev-channel/why-authors-should-avoid-aria-relevant-5d3164fab1e3)  
> 18. Deep dive: understanding live regions, part 2 | JamesJacobs.me, [https://www.jamesjacobs.me/blog/deep-dive-understanding-live-regions-part-2/](https://www.jamesjacobs.me/blog/deep-dive-understanding-live-regions-part-2/)  
> 19. More Accessible Skeletons \- Adrian Roselli, [http://adrianroselli.com/2020/11/more-accessible-skeletons.html](http://adrianroselli.com/2020/11/more-accessible-skeletons.html)  
> 20. Screen reader speech interruptions · Issue \#94 · w3c/at-driver \- GitHub, [https://github.com/w3c/at-driver/issues/94](https://github.com/w3c/at-driver/issues/94)  
> 21. ARIA Live Region Playground, [https://butterpep.com/live-playground.html](https://butterpep.com/live-playground.html)  
> 22. Speech Viewer Logs of Lies \- Adrian Roselli, [http://adrianroselli.com/2020/08/speech-viewer-logs-of-lies.html](http://adrianroselli.com/2020/08/speech-viewer-logs-of-lies.html)  
> 23. alert role (aria) \- Accessibility Support, [https://a11ysupport.io/tech/aria/alert\_role](https://a11ysupport.io/tech/aria/alert_role)  
> 24. Exposing Field Errors \- Adrian Roselli, [http://adrianroselli.com/2023/04/exposing-field-errors.html](http://adrianroselli.com/2023/04/exposing-field-errors.html)  
> 25. Glossary (Docs) \- ICT Testing Baseline Portfolio, [https://ictbaseline.access-board.gov/document-baselines/glossary/](https://ictbaseline.access-board.gov/document-baselines/glossary/)  
> 26. Why Status Messages Must Be Programmatically Exposed \- WebYes, [https://www.webyes.com/knowledge-base/why-status-messages-must-be-programmatically-exposed/](https://www.webyes.com/knowledge-base/why-status-messages-must-be-programmatically-exposed/)