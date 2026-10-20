import { Document, Page, Text, View } from "@react-pdf/renderer";
import { styles } from "./styles";
import { Letterhead, MetaGrid, Footer } from "./Letterhead";
import { formatDate } from "@/lib/utils";

interface RfqPdfProps {
  company: { companyName: string; companyAddress: string; companyReg: string; companyPhone: string };
  rfq: { code: string; quantity: string; respondBy: Date | null; note: string | null; createdAt: Date };
  bomItem: { workPackage: string; description: string | null };
  workItemName: string | null;
  project: { name: string; siteAddress: string };
  vendorName: string;
}

const RESPONSE_FIELDS = [
  "Quoted price (RM, state if inclusive of SST)",
  "Lead time (days from order)",
  "Warranty (months)",
  "Quote valid until",
  "Proposed payment terms",
];

export function RfqPage({ company, rfq, bomItem, workItemName, project, vendorName }: RfqPdfProps) {
  return (
      <Page size="A4" style={styles.page}>
        <Letterhead company={company} docTitle="Request for Quotation" docCode={rfq.code} />

        <MetaGrid
          items={[
            { label: "To", value: vendorName },
            { label: "Date issued", value: formatDate(rfq.createdAt) },
            { label: "Project", value: project.name },
            { label: "Respond by", value: rfq.respondBy ? formatDate(rfq.respondBy) : "As soon as possible" },
            { label: "Site address", value: project.siteAddress },
          ]}
        />

        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.th, { width: "62%" }]}>Scope of work</Text>
            <Text style={[styles.th, { width: "38%", textAlign: "right" }]}>Quantity</Text>
          </View>
          <View style={styles.tableRow}>
            <View style={{ width: "62%" }}>
              <Text style={[styles.td, { fontWeight: 700 }]}>{bomItem.workPackage}</Text>
              {workItemName && <Text style={[styles.muted, { marginTop: 2 }]}>{workItemName}</Text>}
            </View>
            <Text style={[styles.td, { width: "38%", textAlign: "right" }]}>{rfq.quantity}</Text>
          </View>
        </View>

        {bomItem.description && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Specification</Text>
            <Text style={styles.bodyText}>{bomItem.description}</Text>
          </View>
        )}

        {rfq.note && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes to vendor</Text>
            <Text style={styles.bodyText}>{rfq.note}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What we need from you</Text>
          <Text style={styles.bodyText}>
            Please quote for supply and installation of the scope above, unless you state otherwise. Attach your own
            quotation if you have one, and confirm the items below.
          </Text>
        </View>

        <View style={[styles.section, { marginTop: 12 }]} wrap={false}>
          {RESPONSE_FIELDS.map((label) => (
            <View key={label} style={{ flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#bbb", paddingVertical: 8 }}>
              <Text style={[styles.td, { width: "55%", color: "#444" }]}>{label}</Text>
              <Text style={[styles.td, { width: "45%" }]} />
            </View>
          ))}
          <View style={{ flexDirection: "row", marginTop: 22 }}>
            <View style={{ width: "50%" }}>
              <View style={{ borderTopWidth: 0.5, borderTopColor: "#666", width: "80%", paddingTop: 3 }}>
                <Text style={styles.muted}>Authorised signature and company stamp</Text>
              </View>
            </View>
            <View style={{ width: "50%" }}>
              <View style={{ borderTopWidth: 0.5, borderTopColor: "#666", width: "60%", paddingTop: 3 }}>
                <Text style={styles.muted}>Date</Text>
              </View>
            </View>
          </View>
        </View>

        <Footer text={`${company.companyName} — ${company.companyReg}`} />
      </Page>
  );
}

export function RfqPdf(props: RfqPdfProps) {
  return (
    <Document>
      <RfqPage {...props} />
    </Document>
  );
}

// One page per invited vendor, for sending every RFQ in one go.
export function RfqBundlePdf({ pages }: { pages: RfqPdfProps[] }) {
  return (
    <Document>
      {pages.map((p, i) => (
        <RfqPage key={i} {...p} />
      ))}
    </Document>
  );
}
