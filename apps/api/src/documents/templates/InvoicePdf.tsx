import { Document, Page, Text, View } from "@react-pdf/renderer";
import { styles } from "./styles";
import { Letterhead, MetaGrid, Footer } from "./Letterhead";
import { formatCurrency, formatDate } from "@veenix/shared";

interface InvoicePdfProps {
  company: { companyName: string; companyAddress: string; companyReg: string; companyPhone: string; bankName: string; bankAccount: string };
  invoice: {
    code: string;
    invoiceDate: Date;
    dueDate: Date | null;
    amount: number;
    sstAmount: number;
    status: string;
    eInvoiceUuid: string | null;
  };
  milestoneName: string;
  project: { name: string; clientName: string; siteAddress: string };
  sstBps: number;
}

export function InvoicePdf({ company, invoice, milestoneName, project, sstBps }: InvoicePdfProps) {
  const total = invoice.amount + invoice.sstAmount;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead company={company} docTitle="Tax Invoice" docCode={invoice.code} badge={invoice.status} />

        <MetaGrid
          items={[
            { label: "Bill To", value: project.clientName },
            { label: "Project", value: project.name },
            { label: "Site Address", value: project.siteAddress },
            { label: "Invoice Date", value: formatDate(invoice.invoiceDate) },
            { label: "Payment Due", value: formatDate(invoice.dueDate) },
            { label: "Milestone", value: milestoneName },
          ]}
        />

        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.th, styles.colDesc]}>Description</Text>
            <Text style={[styles.th, styles.colTotal]}>Amount (RM)</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={[styles.td, styles.colDesc]}>{milestoneName}</Text>
            <Text style={[styles.td, styles.colTotal]}>{formatCurrency(invoice.amount)}</Text>
          </View>
        </View>

        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text style={styles.totalsValue}>{formatCurrency(invoice.amount)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>{`SST @ ${sstBps / 100}%`}</Text>
            <Text style={styles.totalsValue}>{formatCurrency(invoice.sstAmount)}</Text>
          </View>
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>Total Due</Text>
            <Text style={styles.grandTotalValue}>{formatCurrency(total)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How to Pay</Text>
          <Text style={styles.bodyText}>
            Bank transfer to {company.companyName} — {company.bankName} {company.bankAccount}. Please quote{" "}
            {invoice.code} as the payment reference. DuitNow QR and FPX also accepted on request.
          </Text>
        </View>

        {invoice.eInvoiceUuid && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>LHDN MyInvois e-Invoice</Text>
            <Text style={styles.bodyText}>Validated — UUID {invoice.eInvoiceUuid}</Text>
          </View>
        )}

        <Footer text={`${company.companyName} — ${company.companyReg}`} />
      </Page>
    </Document>
  );
}
