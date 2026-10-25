import { Document, Page, Text, View } from "@react-pdf/renderer";
import { styles } from "./styles";
import { Letterhead, MetaGrid, Footer } from "./Letterhead";
import { formatCurrency, formatDate, formatMoney2, formatNumber } from "@veenix/shared";
import { groupByWorkItem, quotationTotals, unitPrice } from "@veenix/shared";
import { allocate } from "@veenix/shared";

interface QuotationPdfProps {
  company: { companyName: string; companyAddress: string; companyReg: string; companyPhone: string };
  quotation: {
    code: string;
    revision: number;
    status: string;
    acceptedAt: Date | null;
    signedBy: string | null;
  };
  project: { name: string; clientName: string; siteAddress: string };
  lineItems: { workItemName: string | null; workPackage: string; qty: number; unit: string; bomCost: number; clientPrice: number; seq: number }[];
  terms: { seq: number; name: string; trigger: string; pct: number }[];
  sstBps: number;
}

export function QuotationPdf({ company, quotation, project, lineItems, terms, sstBps }: QuotationPdfProps) {
  const { subtotal, sst, total } = quotationTotals(lineItems, sstBps);
  const groups = groupByWorkItem(lineItems);
  const sortedTerms = [...terms].sort((a, b) => a.seq - b.seq);
  const termAmounts = allocate(total, sortedTerms);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          company={company}
          docTitle="Quotation"
          docCode={`${quotation.code} — Rev ${quotation.revision}`}
          badge={quotation.status}
        />

        <MetaGrid
          items={[
            { label: "Bill To", value: project.clientName },
            { label: "Project", value: project.name },
            { label: "Site Address", value: project.siteAddress },
          ]}
        />

        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.th, styles.colDesc]}>Item</Text>
            <Text style={[styles.th, styles.colQty]}>Qty</Text>
            <Text style={[styles.th, styles.colPrice]}>Unit price</Text>
            <Text style={[styles.th, styles.colTotal]}>Amount</Text>
          </View>
          {groups.map((g) => (
            <View key={g.name} wrap={false}>
              <View style={[styles.tableRow, { backgroundColor: "#f3f4f8", borderBottomWidth: 0 }]}>
                <Text style={[styles.td, styles.colDesc, { fontWeight: 700 }]}>{g.name}</Text>
                <Text style={[styles.td, styles.colQty]} />
                <Text style={[styles.td, styles.colPrice]} />
                <Text style={[styles.td, styles.colTotal, { fontWeight: 700 }]}>{formatCurrency(g.subtotal)}</Text>
              </View>
              {g.lines.map((l, i) => (
                <View key={i} style={styles.tableRow}>
                  <Text style={[styles.td, styles.colDesc, { paddingLeft: 10 }]}>{l.workPackage}</Text>
                  <Text style={[styles.td, styles.colQty]}>
                    {formatNumber(l.qty)} {l.unit}
                  </Text>
                  <Text style={[styles.td, styles.colPrice]}>{formatMoney2(unitPrice(l.clientPrice, l.qty))}</Text>
                  <Text style={[styles.td, styles.colTotal]}>{formatCurrency(l.clientPrice)}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text style={styles.totalsValue}>{formatCurrency(subtotal)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>{`SST ${sstBps / 100}%`}</Text>
            <Text style={styles.totalsValue}>{formatCurrency(sst)}</Text>
          </View>
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>Contract Sum</Text>
            <Text style={styles.grandTotalValue}>{formatCurrency(total)}</Text>
          </View>
        </View>

        {sortedTerms.length > 0 && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Payment Terms</Text>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.th, { width: "30%" }]}>Payment</Text>
              <Text style={[styles.th, { width: "34%" }]}>When it is due</Text>
              <Text style={[styles.th, { width: "10%", textAlign: "right" }]}>%</Text>
              <Text style={[styles.th, { width: "26%", textAlign: "right" }]}>Amount (incl. SST)</Text>
            </View>
            {sortedTerms.map((t, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={[styles.td, { width: "30%" }]}>
                  {i + 1}. {t.name}
                </Text>
                <Text style={[styles.td, { width: "34%" }]}>{t.trigger}</Text>
                <Text style={[styles.td, { width: "10%", textAlign: "right" }]}>{t.pct}%</Text>
                <Text style={[styles.td, { width: "26%", textAlign: "right" }]}>{formatCurrency(termAmounts[i])}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Terms</Text>
          <Text style={styles.bodyText}>
            Prices valid for 30 days from issue. Work commences on written acceptance and a deposit per the payment
            schedule. Any change to the scope above requires a signed Variation Order.
          </Text>
        </View>

        {quotation.acceptedAt && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Accepted</Text>
            <Text style={styles.bodyText}>
              Signed by {quotation.signedBy} on {formatDate(quotation.acceptedAt)}.
            </Text>
          </View>
        )}

        <Footer text={`${company.companyName} — ${company.companyReg}`} />
      </Page>
    </Document>
  );
}
