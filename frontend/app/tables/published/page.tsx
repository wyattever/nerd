// frontend/app/tables/published/page.tsx
/**
 * Raw JSON viewer/editor for the published-site snapshot.
 *
 * Sibling to /tables rather than a ?source= branch on it: /tables renders
 * seven AppSheet recovery tables whose shape (HTML fragments parsed by regex)
 * has nothing in common with this denormalized record array. One page
 * branching over two unrelated shapes would be harder to read than two pages.
 *
 * Next 16: searchParams is a Promise and must be awaited. The synchronous
 * compatibility shim from 15 is gone.
 */

import type { Metadata } from "next";
import Link from "next/link";
import {
  getAllPublishedProducts,
  getPublishedProduct,
  getPublishedSchemaVersion,
  getPublishedSnapshotMeta,
} from "@/lib/published-tables";
import { PublishedJsonWorkbench } from "@/components/PublishedJsonWorkbench";
import "../../nerd-table.css";

interface PublishedPageProps {
  searchParams: Promise<{ slug?: string }>;
}

export async function generateMetadata({
  searchParams,
}: PublishedPageProps): Promise<Metadata> {
  const params = await searchParams;
  const record = params.slug ? getPublishedProduct(params.slug) : null;
  return {
    title: record
      ? `${record.product_name} — Published JSON — N.E.R.D.`
      : "Published JSON — N.E.R.D.",
  };
}

export default async function PublishedJsonPage({ searchParams }: PublishedPageProps) {
  const params = await searchParams;
  const products = getAllPublishedProducts();
  const meta = getPublishedSnapshotMeta();
  const schemaVersion = getPublishedSchemaVersion();

  const requested = params.slug ? getPublishedProduct(params.slug) : null;
  const initialSlug = requested?.slug ?? products[0]?.slug ?? "";

  return (
    <div className="nerd-table-page">
      <a className="nerd-skip" href="#nerd-json-main">
        Skip to record
      </a>

      <header className="nerd-header">
        <p className="nerd-eyebrow">N.E.R.D. — Published snapshot</p>
        <h1 className="nerd-title">Raw JSON viewer and editor</h1>
        <p className="nerd-subtitle">
          Inspect and correct <code>published-tables.json</code>, the denormalized snapshot of
          every product page on the live NCADEMI directory.
        </p>
      </header>

      <nav aria-label="Data sources" className="nerd-tables-nav">
        <ul>
          <li>
            <Link href="/tables">AppSheet recovery tables</Link>
          </li>
          <li>
            <span aria-current="page" className="nerd-tables-nav-current">
              Published snapshot JSON
            </span>
          </li>
        </ul>
      </nav>

      <PublishedJsonWorkbench
        initialSlug={initialSlug}
        meta={meta}
        products={products}
        schemaVersion={schemaVersion}
      />
    </div>
  );
}
