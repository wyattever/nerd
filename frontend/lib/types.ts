export interface ResourceLink {
  url: string;
  text: string;
  confidence?: number;
  justification?: string;
}

export interface SupportContact {
  type: "email" | "url" | "text";
  value: string;
  label?: string;
}

export interface ACRReport {
  title: string;
  url: string;
  version?: string;
  date?: string;
  auditor_name?: string;
  auditor_url?: string;
}

export interface SectionOverrides {
  header?: string;
  vendor_resources?: string;
  other_resources?: string;
  support?: string;
  acr?: string;
  ai_insights?: string;
}

export interface ListingData {
  product_name: string;
  vendor_name: string;
  vendor_directory_url: string;
  product_description: string;
  product_website_url: string;
  vendor_resources: ResourceLink[];
  other_resources: ResourceLink[];
  ai_insights: string;
  support_contacts: SupportContact[];
  acr_reports: ACRReport[];
  last_updated?: string;
  section_overrides?: SectionOverrides;
  raw_markdown?: string;
}

export interface DraftDiagnostics {
  parsed_vendor_count: number;
  surviving_vendor_count: number;
  parsed_other_count: number;
  surviving_other_count: number;
  dropped_urls: string[];
  acr_reset: boolean;
}

export interface IngestDraftResponse {
  parsed_listing: ListingData;
  raw_markdown: string;
  rejections: string[];
  diagnostics: DraftDiagnostics;
}

export type SectionKey = "header" | "vendor_resources" | "other_resources" | "support" | "acr" | "ai_insights";

export interface InvalidLink {
  section: string;
  sectionKey: SectionKey;
  text: string;
  url: string;
  reason?: string;
  screenshot_path?: string;
}
