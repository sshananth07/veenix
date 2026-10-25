import { Document, Page, Text, View } from "@react-pdf/renderer";
import { styles } from "./styles";
import { Letterhead, MetaGrid, Footer } from "./Letterhead";
import { formatCurrency, formatDate } from "@veenix/shared";

interface PoPdfProps {
  company: { companyName: string; companyAddress: string; companyReg: string; companyPhone: string };
  po: {
    code: string;
    description: string;
    qty: string;
    amount: number;
    issueDate: Date;
    deliveryBy: Date | null;
    remarks: string | null;
    status: string;
  };
  milestones: { seq: number; label: string; pct: number; amount: number }[];
  vendorName: string;
  project: { name: string; siteAddress: string };
  rfqCode: string | null;
}

export function PoPdf({ company, po, milestones, vendorName, project, rfqCode }: PoPdfProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead company={company} docTitle="Purchase Order" docCode={po.code} badge={po.status} />

        <MetaGrid
          items={[
            { label: "Vendor", value: vendorName },
            { label: "Linked RFQ", value: rfqCode ?? "—" },
            { label: "Issue Date", value: formatDate(po.issueDate) },
            { label: "Delivery By", value: formatDate(po.deliveryBy) },
            { label: "Project", value: project.name },
            { label: "Site", value: project.siteAddress },
          ]}
        />

        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.th, styles.colDesc]}>Description</Text>
            <Text style={[styles.th, styles.colQty]}>Qty</Text>
            <Text style={[styles.th, styles.colTotal]}>Amount (RM)</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={[styles.td, styles.colDesc]}>{po.description}</Text>
            <Text style={[styles.td, styles.colQty]}>{po.qty}</Text>
            <Text style={[styles.td, styles.colTotal]}>{formatCurrency(po.amount)}</Text>
          </View>
        </View>

        <View style={styles.totalsBlock}>
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>PO Total</Text>
            <Text style={styles.grandTotalValue}>{formatCurrency(po.amount)}</Text>
          </View>
        </View>

        {po.remarks && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Remarks</Text>
            <Text style={styles.bodyText}>{po.remarks}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment terms</Text>
          {milestones.length > 0 ? (
            <View style={styles.table}>
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.th, styles.colDesc]}>Milestone</Text>
                <Text style={[styles.th, styles.colQty]}>%</Text>
                <Text style={[styles.th, styles.colTotal]}>Amount (RM)</Text>
              </View>
              {milestones.map((m) => (
                <View key={m.seq} style={styles.tableRow}>
                  <Text style={[styles.td, styles.colDesc]}>{m.label}</Text>
                  <Text style={[styles.td, styles.colQty]}>{m.pct}%</Text>
                  <Text style={[styles.td, styles.colTotal]}>{formatCurrency(m.amount)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.bodyText}>To be agreed.</Text>
          )}
          <Text style={[styles.bodyText, { marginTop: 8 }]}>
            Each payment is released against the vendor's invoice for that milestone. This PO carries the price agreed in the quote comparison.
          </Text>
        </View>

        <Footer text={`${company.companyName} — ${company.companyReg}`} />
      </Page>
    </Document>
  );
}
