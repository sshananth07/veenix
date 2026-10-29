import type { EinvoiceSettings } from "./einvoice.settings";

// UBL 2.1 JSON for Invoice v1.1, in the element order of the SDK's sample. Codes from the SDK code lists:
// state codes, tax types ("02" service tax, "06" not applicable), classification "022" (Others), unit "C62" (one).

const STATE_CODE: Record<string, string> = {
  Johor: "01", Kedah: "02", Kelantan: "03", Melaka: "04", "Negeri Sembilan": "05", Pahang: "06", "Pulau Pinang": "07", Perak: "08",
  Perlis: "09", Selangor: "10", Terengganu: "11", Sabah: "12", Sarawak: "13", "W.P. Kuala Lumpur": "14", "W.P. Labuan": "15", "W.P. Putrajaya": "16",
};
// LHDN's general TINs for buyers without one: Malaysian individuals (with their NRIC) and foreign buyers (with their passport).
const GENERAL_PUBLIC_TIN = "EI00000000010";
const FOREIGN_BUYER_TIN = "EI00000000020";

type Address = { addressLine1?: string | null; addressLine2?: string | null; addressLine3?: string | null; postcode?: string | null; city?: string | null; state?: string | null };
type Project = Address & { name: string; clientName: string; clientPhone?: string | null; clientEmail?: string | null; clientTin?: string | null; clientIdType?: string | null; clientIdNo?: string | null };
export type InvoiceDocInput = {
  invoice: { code: string; amount: number; sstAmount: number };
  org: { companyName: string; sstBps: number };
  settings: EinvoiceSettings;
  project: Project;
  milestoneName: string;
  issuedAt: Date;
};

/** Problems LHDN would reject, worded for staff. Checked before anything is sent. */
export function missingData({ invoice, settings, project }: InvoiceDocInput): string[] {
  const out: string[] = [];
  if (!project.clientPhone) out.push("Add the client's phone number to the project");
  if (!project.addressLine1 || !project.city || !STATE_CODE[project.state ?? ""]) out.push("Add the client's address with city and state to the project");
  if (!project.clientIdType || !project.clientIdNo) out.push("Add the client's ID type and number (NRIC, passport or business registration) to the project");
  if (!project.clientTin && project.clientIdType === "BRN") out.push("A business client needs its TIN on the project");
  if (invoice.sstAmount > 0 && !settings.sstNo) out.push("This invoice charges SST: add your SST registration number in Settings → E-invoice");
  return out;
}

const v = (value: string | number | boolean, attrs: Record<string, string> = {}) => [{ _: value, ...attrs }];
const rm = (sen: number) => v(Number((sen / 100).toFixed(2)), { currencyID: "MYR" });
const id = (value: string, schemeID: string) => ({ ID: v(value, { schemeID }) });

function postalAddress(a: Address) {
  const lines = [a.addressLine1, a.addressLine2, a.addressLine3].filter((l): l is string => !!l?.trim());
  return [{
    CityName: v(a.city ?? ""),
    ...(a.postcode ? { PostalZone: v(a.postcode) } : {}),
    CountrySubentityCode: v(STATE_CODE[a.state ?? ""] ?? "17"),
    AddressLine: lines.map((l) => ({ Line: v(l) })),
    Country: [{ IdentificationCode: v("MYS", { listID: "ISO3166-1", listAgencyID: "6" }) }],
  }];
}

export function buildInvoiceDocument(input: InvoiceDocInput) {
  const { invoice, org, settings: s, project: p, milestoneName, issuedAt } = input;
  const iso = issuedAt.toISOString();
  const sst = invoice.sstAmount > 0 && !!s.sstNo;
  const taxCategory = [{ ID: v(sst ? "02" : "06"), TaxScheme: [{ ID: v("OTH", { schemeID: "UN/ECE 5153", schemeAgencyID: "6" }) }] }];
  const tax = sst ? invoice.sstAmount : 0;
  const buyerTin = p.clientTin || (p.clientIdType === "PASSPORT" ? FOREIGN_BUYER_TIN : GENERAL_PUBLIC_TIN);

  return {
    _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    Invoice: [{
      ID: v(invoice.code),
      IssueDate: v(iso.slice(0, 10)),
      IssueTime: v(`${iso.slice(11, 19)}Z`),
      InvoiceTypeCode: v("01", { listVersionID: "1.1" }),
      DocumentCurrencyCode: v("MYR"),
      TaxCurrencyCode: v("MYR"),
      AccountingSupplierParty: [{
        Party: [{
          IndustryClassificationCode: v(s.msicCode, { name: s.businessActivity }),
          PartyIdentification: [id(s.tin, "TIN"), id(s.brn, "BRN"), id(s.sstNo ?? "NA", "SST"), id("NA", "TTX")],
          PostalAddress: postalAddress(s),
          PartyLegalEntity: [{ RegistrationName: v(org.companyName) }],
          Contact: [{ Telephone: v(s.phone) }],
        }],
      }],
      AccountingCustomerParty: [{
        Party: [{
          PostalAddress: postalAddress(p),
          PartyLegalEntity: [{ RegistrationName: v(p.clientName) }],
          PartyIdentification: [id(buyerTin, "TIN"), id(p.clientIdNo ?? "NA", p.clientIdType ?? "NRIC"), id("NA", "SST"), id("NA", "TTX")],
          Contact: [{ Telephone: v(p.clientPhone ?? ""), ...(p.clientEmail ? { ElectronicMail: v(p.clientEmail) } : {}) }],
        }],
      }],
      TaxTotal: [{ TaxAmount: rm(tax), TaxSubtotal: [{ TaxableAmount: rm(invoice.amount), TaxAmount: rm(tax), TaxCategory: taxCategory }] }],
      LegalMonetaryTotal: [{
        LineExtensionAmount: rm(invoice.amount),
        TaxExclusiveAmount: rm(invoice.amount),
        TaxInclusiveAmount: rm(invoice.amount + tax),
        PayableAmount: rm(invoice.amount + tax),
      }],
      InvoiceLine: [{
        ID: v("1"),
        InvoicedQuantity: v(1, { unitCode: "C62" }),
        LineExtensionAmount: rm(invoice.amount),
        TaxTotal: [{
          TaxAmount: rm(tax),
          TaxSubtotal: [{ TaxableAmount: rm(invoice.amount), TaxAmount: rm(tax), Percent: v(sst ? org.sstBps / 100 : 0), TaxCategory: taxCategory }],
        }],
        Item: [{
          CommodityClassification: [{ ItemClassificationCode: v("022", { listID: "CLASS" }) }],
          Description: v(`${p.name}: ${milestoneName}`.slice(0, 300)),
        }],
        Price: [{ PriceAmount: rm(invoice.amount) }],
        ItemPriceExtension: [{ Amount: rm(invoice.amount) }],
      }],
    }],
  };
}
