export interface ResourceLink {
  url: string;
  text: string;
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
}

export interface InvalidLink {
  section: string;
  text: string;
  url: string;
  reason?: string;
  screenshot_path?: string;
}
