import { z } from "zod";

export const ResourceLinkSchema = z.object({
  url: z.string().min(1, "URL is required"),
  text: z.string().min(1, "Link text is required"),
});

export const SupportContactSchema = z.object({
  type: z.enum(["email", "url", "text"]),
  value: z.string().min(1, "Contact value is required"),
  label: z.string().default(""),
});

export const ACRReportSchema = z.object({
  title: z.string().min(1, "Report title is required"),
  url: z.string().min(1, "Report URL is required"),
  version: z.string().default(""),
  date: z.string().default(""),
  auditor_name: z.string().default(""),
  auditor_url: z.string().default(""),
});

export const ListingDataSchema = z.object({
  product_name: z.string().default("Unknown Product"),
  vendor_name: z.string().default(""),
  vendor_directory_url: z.string().default("#"),
  product_description: z.string().default(""),
  product_website_url: z.string().default("#"),
  vendor_resources: z.array(ResourceLinkSchema).default([]),
  other_resources: z.array(ResourceLinkSchema).default([]),
  ai_insights: z.string().default(""),
  support_contacts: z.array(SupportContactSchema).default([]),
  acr_reports: z.array(ACRReportSchema).default([]),
  last_updated: z.string().nullable().optional(),
});

export type ListingData = z.infer<typeof ListingDataSchema>;
export type ResourceLink = z.infer<typeof ResourceLinkSchema>;
export type SupportContact = z.infer<typeof SupportContactSchema>;
export type ACRReport = z.infer<typeof ACRReportSchema>;
