# Implementation Guide: Architectural Steps for the `/records/vendors` Route

This document details the exact steps required to implement the read-only `/records/vendors` page, aligning it with the existing records infrastructure and wiring it into the new `IntegratedListPanel`.

## Overview & Wiring Status

The `IntegratedListPanel.tsx` component already defines the `vendors` category in its `CATEGORY_TABS` array. When the user clicks the "Vendor" tab while in "Records" mode, the panel routes to `/records/vendors`. Because the wiring already exists, we only need to construct the matching route directory and its required layout/page components.

## Step 1: Create the Layout

Create the layout that fetches vendor data and wraps the children in the `IntegratedListPanel`.

**File:** `frontend/app/records/(routed)/vendors/layout.tsx`

```tsx
import type { ReactNode } from "react";
import { getVendors } from "@/lib/local-data";
import { IntegratedListPanel } from "@/components/IntegratedListPanel";

export const dynamic = "force-dynamic";

export default async function RecordsVendorsLayout({ children }: { children: ReactNode }) {
  // Retrieve read-only vendor records
  const { vendors } = await getVendors();
  
  return (
    <IntegratedListPanel 
      items={vendors} 
      baseRoute="/records/vendors" 
      activeMode="records" 
      activeCategory="vendors"
    >
      {children}
    </IntegratedListPanel>
  );
}
```

## Step 2: Create the Index Page

Create the default placeholder page shown before a specific vendor is selected.

**File:** `frontend/app/records/(routed)/vendors/page.tsx`

```tsx
export default function RecordsVendorsPage() {
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center text-gray-400">
      <p className="text-sm">Select a vendor from the list to view details.</p>
    </div>
  );
}
```

## Step 3: Create the Detail Route

Create the dynamic slug page that finds the selected vendor and passes it to the detail component.

**File:** `frontend/app/records/(routed)/vendors/[slug]/page.tsx`

```tsx
import { notFound } from "next/navigation";
import { getVendors } from "@/lib/local-data";
import { RecordsVendorDetail } from "./RecordsVendorDetail";

export default async function VendorRecordDetailPage({ params }: { params: { slug: string } }) {
  const { vendors } = await getVendors();
  const vendor = vendors.find(v => v.slug === params.slug);

  if (!vendor) {
    notFound();
  }

  return <RecordsVendorDetail vendor={vendor} />;
}
```

## Step 4: Create the Read-Only Detail Component

Create the visual presentation component for the read-only vendor record. This mirrors `RecordsPublishedDetail.tsx` but caters to vendor-specific schema fields.

**File:** `frontend/app/records/(routed)/vendors/[slug]/RecordsVendorDetail.tsx`

```tsx
"use client";

import type { DirectoryRecord } from "@/lib/directory-schema";
import { DirectoryPreview } from "@/components/DirectoryPreview";

interface RecordsVendorDetailProps {
  vendor: DirectoryRecord;
}

export function RecordsVendorDetail({ vendor }: RecordsVendorDetailProps) {
  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      <div className="border-b border-gray-200 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">{vendor.product_name}</h1>
        <p className="text-sm text-gray-500 mt-1">Read-only vendor record</p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-6">
          <DirectoryPreview data={vendor} />
        </div>
      </div>
    </div>
  );
}
```

> **Note on Schema:** Even though the entity is a "Vendor", the local data parser (`getVendors`) resolves data into the standardized `DirectoryRecord` schema. Reusing `DirectoryPreview` safely handles the read-only presentation without duplicating layout code.
