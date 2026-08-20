import type { Metadata } from "next";
import Link from "next/link";
import { APPSHEET_TABLES, getTable, DEFAULT_TABLE_SLUG } from "@/lib/appsheet-tables";
import "../nerd-table.css";

interface PageProps {
  searchParams: Promise<{ table?: string }>;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const active = getTable(params.table) ?? getTable(DEFAULT_TABLE_SLUG)!;
  return {
    title: `${active.title} — Tables — N.E.R.D.`,
  };
}

export default async function TablesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const active = getTable(params.table) ?? getTable(DEFAULT_TABLE_SLUG)!;

  return (
    <div className="nerd-table-page">
      <a className="nerd-skip" href={`#${active.table_id}`}>
        Skip to table
      </a>

      <header className="nerd-header">
        <p className="nerd-eyebrow">N.E.R.D. — AppSheet Recovery</p>
        <h1 className="nerd-title">{active.title}</h1>
      </header>

      <nav className="nerd-tables-nav" aria-label="AppSheet tables">
        <ul>
          {APPSHEET_TABLES.map((t) => {
            const isActive = t.slug === active.slug;
            return (
              <li key={t.slug}>
                {isActive ? (
                  <span className="nerd-tables-nav-current" aria-current="page">
                    {t.title}
                  </span>
                ) : (
                  <Link href={`/tables?table=${t.slug}`}>{t.title}</Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <main dangerouslySetInnerHTML={{ __html: active.html }} />
    </div>
  );
}
