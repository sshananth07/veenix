import { Text, View } from "@react-pdf/renderer";
import { styles } from "./styles";

export function Letterhead({
  company,
  docTitle,
  docCode,
  badge,
}: {
  company: { companyName: string; companyAddress: string; companyReg: string; companyPhone: string };
  docTitle: string;
  docCode: string;
  badge?: string;
}) {
  return (
    <View style={styles.headerRow}>
      <View>
        <Text style={styles.companyName}>{company.companyName}</Text>
        <Text style={styles.muted}>{company.companyAddress}</Text>
        <Text style={styles.muted}>{company.companyReg}</Text>
        <Text style={styles.muted}>{company.companyPhone}</Text>
      </View>
      <View>
        {badge && <Text style={styles.badge}>{badge}</Text>}
        <Text style={styles.docTitle}>{docTitle}</Text>
        <Text style={styles.docCode}>{docCode}</Text>
      </View>
    </View>
  );
}

export function MetaGrid({ items }: { items: { label: string; value: string }[] }) {
  return (
    <View style={styles.metaGrid}>
      {items.map((item) => (
        <View key={item.label} style={styles.metaCol}>
          <Text style={styles.metaLabel}>{item.label}</Text>
          <Text style={styles.metaValue}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

export function Footer({ text }: { text: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text>{text}</Text>
    </View>
  );
}
