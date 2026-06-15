# N.E.R.D. UI Diagnostic Report (June 14, 2026)

## 1. Issue Description
**Symptom:** "Page Unresponsive" browser crash immediately after clicking "Generate Listing".
**Context:** This occurred after integrating the `useResearchApi` hook (SSE data loop) with the rich `ResourceGrids` (TanStack Table) and `LivePreview` (Jinja2 renderer) components.

---

## 2. Suspected Root Causes (Technical Analysis)

### A. The "Reset Loop" (High Probability)
In `app/page.tsx`, there is a `useEffect` that calls `methods.reset(state.result.parsedListing)` whenever the `state.status` becomes `complete`. 
*   **The Risk:** If `methods.reset` triggers a re-render that somehow causes the `useResearchApi` hook or its parent to re-evaluate or emit a new state object, the effect will fire again.
*   **Complexity:** React Hook Form's `reset` is a heavy operation when paired with `useFieldArray` (used in `ResourceGrids`).

### B. Live Preview Debounce Contention
`LivePreview.tsx` watches the entire form state using `useWatch`. When research completes and 50+ fields are populated at once:
*   The `useWatch` fires for every field.
*   The `useEffect` in `LivePreview` attempts to `fetch` the `/render` endpoint.
*   If the render response updates a state that `app/page.tsx` is watching, it creates a circular dependency.

### C. SSE Message Overload
The `@microsoft/fetch-event-source` handler updates the React `state` on every `onmessage`. 
*   If the backend emits status updates too rapidly, React may be struggling to keep up with the re-render queue, especially while TanStack table is calculating layouts.

---

## 3. Relevant UI Source Code

### Component: `app/page.tsx` (The Orchestrator)
```typescript
"use client";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useResearchApi } from "@/hooks/useResearchApi";
import { ResearchForm } from "@/components/ResearchForm";
import { ResourceGrids } from "@/components/ResourceGrids";
import { LivePreview } from "@/components/LivePreview";
import { ListingSchema, type ListingData } from "@/schemas/listing";

export default function Home() {
  const { state, startInitialResearch, startDeepDive } = useResearchApi();
  const methods = useForm<ListingData>({
    resolver: zodResolver(ListingSchema),
    defaultValues: { /* ... empty defaults ... */ },
  });

  // POTENTIAL LOOP POINT:
  useEffect(() => {
    if (state.status === "complete" && state.result?.parsedListing) {
      methods.reset(state.result.parsedListing);
    }
  }, [state.status, state.result, methods]);

  return (
    <main className="nerd-layout">
      <ResearchForm researchState={state} onStartInitial={startInitialResearch} ... />
      <FormProvider {...methods}>
        <ResourceGrids />
        <LivePreview />
      </FormProvider>
    </main>
  );
}
```

### Component: `hooks/useResearchApi.ts` (SSE Hook)
```typescript
export function useResearchApi() {
  const [state, setState] = useState<ResearchState>(INITIAL_STATE);
  // ... fetchEventSource logic ...
  onmessage(event) {
    if (event.event === 'status') {
      setState((prev) => ({ ...prev, status: data.status }));
    } 
    if (event.event === 'result') {
      setState((prev) => ({ ...prev, status: 'complete', result: data.parsed_listing }));
    }
  }
}
```

### Component: `components/LivePreview.tsx` (The Renderer)
```typescript
export function LivePreview() {
  const { control } = useFormContext<ListingData>();
  const formValues = useWatch({ control }) as ListingData;
  const debouncedValues = useDebounce(formValues, 600);

  useEffect(() => {
    // Fetches /render on every debounced change
    fetch(`${API_BASE}/render`, { body: JSON.stringify(debouncedValues) })
      .then(...)
      .then(data => iframeRef.current.srcdoc = data.html);
  }, [debouncedValues]);
}
```

---

## 4. Request for Simplified/Reliable Options

We need a strategy to decouple the **streaming data** from the **editing state** to prevent main-thread blockage.

**Option 1: One-Way Sync Only**
Disable the `LivePreview` and `ResourceGrids` *during* the active research phase. Only "unlock" and populate them once the SSE stream sends the `end` event. This prevents intermediate re-renders.

**Option 2: "Draft" Buffer State**
Store the SSE results in a simple "Draft" object first. Add a manual "Load into Editor" button so the human chooses exactly when to trigger the heavy `methods.reset()` and TanStack layout calculations.

**Option 3: Component Isolation**
Move the `useResearchApi` hook into a separate sibling component so that status updates only re-render the status bar, not the entire form/grid/preview tree.

---

### **Understanding & Acknowledgement**
I understand that the browser is hanging due to the computational cost of re-rendering a complex, multi-grid form while simultaneously processing a stream of SSE updates and debounced preview renders. I have documented the suspected "Reset Loop" and "Contention" points above.

**I am now waiting for your instructions on which path to take or if you have specific code to apply.**