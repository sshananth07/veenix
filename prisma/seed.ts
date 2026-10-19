import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SST = 0.08;

async function main() {
  await prisma.settings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });

  await prisma.invoice.deleteMany();
  await prisma.paymentMilestone.deleteMany();
  await prisma.variationOrder.deleteMany();
  await prisma.quotationEvent.deleteMany();
  await prisma.quotationLineItem.deleteMany();
  await prisma.quotation.deleteMany();
  await prisma.poMilestone.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.rfqVendorQuote.deleteMany();
  await prisma.rfq.deleteMany();
  await prisma.bomMaterial.deleteMany();
  await prisma.bomItem.deleteMany();
  await prisma.workItem.deleteMany();
  await prisma.project.deleteMany();
  await prisma.leadActivity.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.vendor.deleteMany();

  const v = async (name: string, type: string, jobsCount: number) => prisma.vendor.create({ data: { name, type, jobsCount } });
  const khCarpentry = await v("KH Carpentry Works", "Kitchen and carpentry specialist", 14);
  const homeline = await v("Homeline Kitchens Sdn Bhd", "Kitchen cabinets, new vendor", 0);
  const eliteWoodwork = await v("Elite Woodwork Enterprise", "Kitchen and carpentry specialist", 3);
  const bina = await v("Syarikat Bina Jaya", "Hacking and masonry", 22);
  const sengHeng = await v("Seng Heng Elektrik", "Electrical", 31);
  const gypsum = await v("Gypsum Deco", "Plaster ceiling", 18);
  const aircond = await v("Aircond Master", "Air-conditioning", 9);
  const aquaflow = await v("AquaFlow Plumbing Sdn Bhd", "Plumbing", 15);
  const ags = await v("AGS Aluminium", "Glass and aluminium", 11);

  // ---- Helpers -------------------------------------------------------------
  const codeCounter = { rfq: 27, po: 411, qt: 117 };

  async function addBom(
    projectId: string,
    workItemId: string,
    seq: number,
    d: {
      name: string;
      qty: number;
      unit: string;
      unitCost: number;
      by: "SELF" | "OUTSOURCED";
      materials?: { name: string; qty: number; unit: string; unitCost: number }[];
    }
  ) {
    const materials = (d.materials ?? []).map((m) => ({ ...m, total: Math.round(m.qty * m.unitCost) }));
    const estTotal = Math.round(d.qty * d.unitCost) + materials.reduce((s, m) => s + m.total, 0);
    return prisma.bomItem.create({
      data: {
        projectId,
        workItemId,
        seq,
        workPackage: d.name,
        qty: d.qty,
        unit: d.unit,
        unitCost: d.unitCost,
        estTotal,
        performedBy: d.by,
        materials: { create: materials },
      },
    });
  }

  // RFQ with quotes; when `award` is given it becomes a PO with payment milestones.
  async function rfqFor(
    projectId: string,
    bom: { id: string; workPackage: string; qty: number; unit: string },
    quotes: { vendor: { id: string }; price: number; days: number; warranty: number; notes?: string }[],
    award?: { winner: number; terms: { label: string; pct: number; paid?: boolean }[]; issued: string }
  ) {
    codeCounter.rfq += 1;
    const rfq = await prisma.rfq.create({
      data: {
        code: `RFQ-${String(codeCounter.rfq).padStart(4, "0")}`,
        projectId,
        bomItemId: bom.id,
        quantity: `${bom.qty} ${bom.unit}`,
        respondBy: new Date("2026-09-20"),
        quotes: {
          create: quotes.map((q, i) => ({
            vendorId: q.vendor.id,
            receivedAt: new Date("2026-09-14"),
            quotedPrice: q.price,
            leadTimeDays: q.days,
            warrantyMonths: q.warranty,
            notes: q.notes,
            selected: award?.winner === i,
          })),
        },
      },
    });
    if (!award) return rfq;

    const winner = quotes[award.winner];
    codeCounter.po += 1;
    let running = 0;
    const milestones = award.terms.map((t, i) => {
      const amount = i === award.terms.length - 1 ? winner.price - running : Math.round((winner.price * t.pct) / 100);
      running += amount;
      return {
        seq: i + 1,
        label: t.label,
        pct: t.pct,
        amount,
        status: t.paid ? "PAID" : "PENDING",
        invoiceNo: t.paid ? `INV-${1000 + codeCounter.po + i}` : null,
        invoiceDate: t.paid ? new Date(award.issued) : null,
        paidAmount: t.paid ? amount : null,
        paidDate: t.paid ? new Date(award.issued) : null,
        method: t.paid ? "Bank Transfer" : null,
        bankRef: t.paid ? `TXN-88${codeCounter.po}${i}` : null,
      };
    });
    await prisma.purchaseOrder.create({
      data: {
        code: `PO-${String(codeCounter.po).padStart(4, "0")}`,
        projectId,
        rfqId: rfq.id,
        vendorId: winner.vendor.id,
        description: bom.workPackage,
        qty: rfq.quantity,
        amount: winner.price,
        issueDate: new Date(award.issued),
        deliveryBy: new Date("2026-10-15"),
        status: award.terms.every((t) => t.paid) ? "PAID" : "ISSUED",
        milestones: { create: milestones },
      },
    });
    return rfq;
  }

  // ---- Leads ---------------------------------------------------------------
  const leads = [
    { code: "L-2026-0188", name: "Tan Siew Kim", phone: "+60 16-778 2231", source: "Referral", propertyType: "Condo, 1,100 sq ft", budgetMin: 230000, budgetMax: 250000, status: "CONTACTED" },
    { code: "L-2026-0189", name: "Chong Mei Ling", phone: "+60 12-990 4412", source: "Instagram", propertyType: "Terrace, 20x70", budgetMin: 170000, budgetMax: 190000, status: "CONTACTED" },
    { code: "L-2026-0190", name: "Ismail Bakar", phone: "+60 19-234 5567", source: "Walk-in", propertyType: "Apartment, 900 sq ft", budgetMin: 55000, budgetMax: 65000, status: "NEW" },
    { code: "L-2026-0193", name: "Kamal Yusof", phone: "+60 13-887 2201", source: "Instagram", propertyType: "Studio, 550 sq ft", budgetMin: 50000, budgetMax: 60000, status: "LOST" },
    { code: "L-2026-0194", name: "Suresh Pillai", phone: "+60 16-220 4471", source: "Referral", propertyType: "Terrace, 22x75", budgetMin: 70000, budgetMax: 85000, status: "NEW" },
  ];
  for (const l of leads) await prisma.lead.create({ data: l });

  const aisyahLead = await prisma.lead.create({
    data: {
      code: "L-2026-0187",
      name: "Puan Aisyah Rahman",
      phone: "+60 12-345 6789",
      email: "aisyah.rahman@gmail.com",
      source: "Facebook Ads",
      campaign: "Reno Promo Oct 2026",
      propertyType: "Semi-D, 2 storey",
      builtUpArea: "2,400 sq ft",
      budgetMin: 180000,
      budgetMax: 220000,
      siteAddress: "Jalan Rimbayu 5/2, Bandar Rimbayu, Selangor",
      targetStart: "Early October 2026",
      assignedTo: "Hafiz",
      status: "CONVERTED",
      surveyAt: new Date("2026-09-17T15:00:00"),
      createdAt: new Date("2026-09-14T10:42:00"),
      activities: {
        create: [
          { note: "Lead created from Facebook Ads form", createdAt: new Date("2026-09-14T10:42:00") },
          { note: "Hafiz called, qualified, booked site survey", createdAt: new Date("2026-09-14T11:05:00") },
          { note: "Site survey done with Kumar", createdAt: new Date("2026-09-17T15:00:00") },
        ],
      },
    },
  });
  const deviLead = await prisma.lead.create({
    data: { code: "L-2026-0191", name: "Devi Kumaran", phone: "+60 17-654 3321", source: "Facebook Ads", propertyType: "Semi-D, 2,600 sq ft", builtUpArea: "2,600 sq ft", budgetMin: 160000, budgetMax: 180000, siteAddress: "Kota Kemuning, Selangor", assignedTo: "Hafiz", status: "CONVERTED", surveyAt: new Date("2026-09-12T10:00:00") },
  });

  // ---- Project 1: Aisyah, fully priced, quotation Rev 2 signed ----------------
  const p1 = await prisma.project.create({
    data: {
      code: "PRJ-2026-041",
      name: "Aisyah Residence, Full Interior Fit-out",
      clientName: "Aisyah Rahman",
      clientPhone: "+60 12-345 6789",
      clientEmail: "aisyah.rahman@gmail.com",
      siteAddress: "Jalan Rimbayu 5/2, Bandar Rimbayu, Selangor",
      propertyType: "Semi-D, 2 storey",
      builtUpArea: "2,400 sq ft",
      budgetMin: 180000,
      budgetMax: 220000,
      campaign: "Reno Promo Oct 2026",
      surveyAt: new Date("2026-09-17T15:00:00"),
      targetStart: new Date("2026-10-06"),
      targetHandover: new Date("2026-12-22"),
      pmName: "Hafiz",
      siteName: "Kumar",
      stage: "WORK_IN_PROGRESS",
      leadId: aisyahLead.id,
    },
  });
  const wi = async (projectId: string, seq: number, name: string) => prisma.workItem.create({ data: { projectId, seq, name } });
  const wStruct = await wi(p1.id, 1, "Structural and M&E");
  const wKitchen = await wi(p1.id, 2, "Kitchen");
  const wHall = await wi(p1.id, 3, "Living and Hall");
  const wBath = await wi(p1.id, 4, "Bathrooms");
  const wCarp = await wi(p1.id, 5, "Carpentry");

  const done = [{ label: "Deposit", pct: 30, paid: true }, { label: "On completion", pct: 70, paid: true }];
  const structural = [
    { name: "Hacking, demolition and disposal", qty: 1, unit: "lot", cost: 5800, vendor: bina, price: 5800 },
    { name: "Masonry, plaster and waterproofing", qty: 1, unit: "lot", cost: 8900, vendor: bina, price: 8900 },
    { name: "Plumbing and sanitary works", qty: 1, unit: "lot", cost: 6300, vendor: aquaflow, price: 6300 },
    { name: "Electrical rewiring and light points", qty: 48, unit: "point", cost: 204.17, vendor: sengHeng, price: 9800 },
    { name: "Air-cond, 4 units with piping", qty: 4, unit: "unit", cost: 3150, vendor: aircond, price: 12600 },
    { name: "Plaster ceiling and cove lighting", qty: 1850, unit: "sq ft", cost: 6.97, vendor: gypsum, price: 12900 },
  ];
  const bomP1: { id: string; name: string; workItemName: string; workItemId: string; qty: number; unit: string; cost: number }[] = [];
  let seq = 0;
  for (const s of structural) {
    const bom = await addBom(p1.id, wStruct.id, ++seq, { name: s.name, qty: s.qty, unit: s.unit, unitCost: s.cost, by: "OUTSOURCED" });
    await rfqFor(p1.id, bom, [{ vendor: s.vendor, price: s.price, days: 10, warranty: 12 }], { winner: 0, terms: done, issued: "2026-09-12" });
    bomP1.push({ id: bom.id, name: s.name, workItemName: "Structural and M&E", workItemId: wStruct.id, qty: s.qty, unit: s.unit, cost: s.price });
  }

  const kitchen = await addBom(p1.id, wKitchen.id, ++seq, { name: "Kitchen cabinet with quartz top", qty: 3600, unit: "mm run", unitCost: 6.53, by: "OUTSOURCED" });
  await rfqFor(
    p1.id,
    kitchen,
    [
      { vendor: homeline, price: 24800, days: 18, warranty: 12, notes: "Premium hardware brand" },
      { vendor: khCarpentry, price: 23500, days: 14, warranty: 24, notes: "14 jobs with us, on time" },
      { vendor: eliteWoodwork, price: 22900, days: 21, warranty: 12, notes: "Cheapest, new to us" },
    ],
    { winner: 1, terms: [{ label: "Deposit", pct: 30, paid: true }, { label: "Progress", pct: 40 }, { label: "On completion", pct: 30 }], issued: "2026-09-15" }
  );
  bomP1.push({ id: kitchen.id, name: kitchen.workPackage, workItemName: "Kitchen", workItemId: wKitchen.id, qty: 3600, unit: "mm run", cost: 23500 });

  const kitchenTile = await addBom(p1.id, wKitchen.id, ++seq, {
    name: "Kitchen wall tiling",
    qty: 180,
    unit: "sq ft",
    unitCost: 3.5,
    by: "SELF",
    materials: [
      { name: "Ceramic wall tiles", qty: 190, unit: "sq ft", unitCost: 3.8 },
      { name: "Tile adhesive and grout", qty: 6, unit: "bag", unitCost: 22 },
    ],
  });
  bomP1.push({ id: kitchenTile.id, name: kitchenTile.workPackage, workItemName: "Kitchen", workItemId: wKitchen.id, qty: 180, unit: "sq ft", cost: kitchenTile.estTotal });

  const hallTile = await addBom(p1.id, wHall.id, ++seq, {
    name: "Floor tiling, Hall",
    qty: 450,
    unit: "sq ft",
    unitCost: 3.5,
    by: "SELF",
    materials: [
      { name: "Porcelain floor tiles 600x600", qty: 470, unit: "sq ft", unitCost: 4.2 },
      { name: "Tile adhesive and grout", qty: 14, unit: "bag", unitCost: 22 },
    ],
  });
  bomP1.push({ id: hallTile.id, name: hallTile.workPackage, workItemName: "Living and Hall", workItemId: wHall.id, qty: 450, unit: "sq ft", cost: hallTile.estTotal });

  const painting = await addBom(p1.id, wHall.id, ++seq, {
    name: "Painting, full house",
    qty: 2400,
    unit: "sq ft",
    unitCost: 0.9,
    by: "SELF",
    materials: [{ name: "Emulsion paint 18L", qty: 9, unit: "pail", unitCost: 240 }, { name: "Sealer and putty", qty: 1, unit: "lot", unitCost: 480 }],
  });
  bomP1.push({ id: painting.id, name: painting.workPackage, workItemName: "Living and Hall", workItemId: wHall.id, qty: 2400, unit: "sq ft", cost: painting.estTotal });

  const bathTile = await addBom(p1.id, wBath.id, ++seq, {
    name: "Floor and wall tiling, Bathrooms",
    qty: 320,
    unit: "sq ft",
    unitCost: 4.5,
    by: "SELF",
    materials: [{ name: "Bathroom tiles", qty: 335, unit: "sq ft", unitCost: 5.6 }, { name: "Waterproofing and adhesive", qty: 1, unit: "lot", unitCost: 520 }],
  });
  bomP1.push({ id: bathTile.id, name: bathTile.workPackage, workItemName: "Bathrooms", workItemId: wBath.id, qty: 320, unit: "sq ft", cost: bathTile.estTotal });

  const glass = await addBom(p1.id, wBath.id, ++seq, { name: "Glass and aluminium shower screens", qty: 2, unit: "set", unitCost: 2700, by: "OUTSOURCED" });
  await rfqFor(p1.id, glass, [{ vendor: ags, price: 5400, days: 12, warranty: 12 }], { winner: 0, terms: [{ label: "Deposit", pct: 50 }, { label: "On installation", pct: 50 }], issued: "2026-09-18" });
  bomP1.push({ id: glass.id, name: glass.workPackage, workItemName: "Bathrooms", workItemId: wBath.id, qty: 2, unit: "set", cost: 5400 });

  const wardrobe = await addBom(p1.id, wCarp.id, ++seq, { name: "Wardrobe and TV feature wall", qty: 1, unit: "lot", unitCost: 19600, by: "OUTSOURCED" });
  await rfqFor(p1.id, wardrobe, [{ vendor: khCarpentry, price: 19600, days: 20, warranty: 24 }], { winner: 0, terms: [{ label: "Deposit", pct: 30 }, { label: "Progress", pct: 40 }, { label: "On completion", pct: 30 }], issued: "2026-09-18" });
  bomP1.push({ id: wardrobe.id, name: wardrobe.workPackage, workItemName: "Carpentry", workItemId: wCarp.id, qty: 1, unit: "lot", cost: 19600 });

  // Quotation Rev 1 (superseded) and Rev 2 (signed)
  const markups = [45, 44, 46, 48, 33, 44, 45, 40, 40, 40, 40, 46, 45];
  const line = (b: (typeof bomP1)[number], i: number, uplift = 0) => {
    const markup = markups[i % markups.length] + uplift;
    return { bomItemId: b.id, workItemName: b.workItemName, workPackage: b.name, qty: b.qty, unit: b.unit, bomCost: b.cost, markupPct: markup, clientPrice: Math.round(b.cost * (1 + markup / 100)), seq: i };
  };
  await prisma.quotation.create({
    data: {
      code: "QT-2026-0117",
      revision: 1,
      projectId: p1.id,
      status: "SUPERSEDED",
      createdAt: new Date("2026-09-18T09:00:00"),
      sentAt: new Date("2026-09-18T20:02:00"),
      viewedAt: new Date("2026-09-18T20:40:00"),
      lineItems: { create: bomP1.slice(0, 9).map((b, i) => line(b, i)) },
      events: {
        create: [
          { type: "SENT", note: "Link sent via WhatsApp and email", createdAt: new Date("2026-09-18T20:02:00") },
          { type: "VIEWED", createdAt: new Date("2026-09-18T20:40:00") },
          { type: "QUESTIONED", note: "Client asked to add bathrooms, glass and carpentry", createdAt: new Date("2026-09-18T21:00:00") },
        ],
      },
    },
  });
  const rev2Lines = bomP1.map((b, i) => line(b, i));
  const rev2Total = Math.round(rev2Lines.reduce((s, l) => s + l.clientPrice, 0) * (1 + SST));
  await prisma.quotation.create({
    data: {
      code: "QT-2026-0118",
      revision: 2,
      projectId: p1.id,
      status: "ACCEPTED",
      createdAt: new Date("2026-09-19T08:30:00"),
      sentAt: new Date("2026-09-19T20:02:00"),
      viewedAt: new Date("2026-09-19T20:55:00"),
      acceptedAt: new Date("2026-09-19T21:14:00"),
      signedBy: "Aisyah binti Rahman",
      lineItems: { create: rev2Lines },
      events: {
        create: [
          { type: "SENT", note: "Link sent via WhatsApp and email", createdAt: new Date("2026-09-19T20:02:00") },
          { type: "VIEWED", createdAt: new Date("2026-09-19T20:55:00") },
          { type: "ACCEPTED", note: "Signed by Aisyah binti Rahman, IP logged", createdAt: new Date("2026-09-19T21:14:00") },
        ],
      },
    },
  });
  await prisma.project.update({ where: { id: p1.id }, data: { contractValue: rev2Total } });

  const share = (pct: number) => Math.round((rev2Total * pct) / 100);
  const m1 = await prisma.paymentMilestone.create({ data: { projectId: p1.id, seq: 1, name: "Deposit", trigger: "On contract acceptance", pct: 30, amount: share(30), status: "PAID" } });
  await prisma.invoice.create({
    data: { code: "INV-2026-0233", milestoneId: m1.id, invoiceDate: new Date("2026-09-20"), dueDate: new Date("2026-09-27"), amount: Math.round(share(30) / (1 + SST)), sstAmount: share(30) - Math.round(share(30) / (1 + SST)), status: "PAID", eInvoiceUuid: "F9K2M-1006-77A3B0", eInvoiceValidatedAt: new Date("2026-09-20T09:10:00") },
  });
  await prisma.paymentMilestone.create({ data: { projectId: p1.id, seq: 2, name: "M&E complete", trigger: "Week 4, plumbing and electrical", pct: 30, amount: share(30), status: "AWAITING_PAYMENT" } });
  await prisma.paymentMilestone.create({ data: { projectId: p1.id, seq: 3, name: "Ceiling and tiling done", trigger: "Week 8", pct: 25, amount: share(25), status: "NOT_YET_DUE" } });
  await prisma.paymentMilestone.create({ data: { projectId: p1.id, seq: 4, name: "Handover", trigger: "Week 12", pct: 15, amount: rev2Total - share(30) - share(30) - share(25), status: "NOT_YET_DUE" } });
  await prisma.variationOrder.create({
    data: { code: "VO-0001", projectId: p1.id, description: "Upgrade kitchen cabinet doors from laminate gloss to matte finish", raisedBy: "Hafiz", amount: 1200, status: "CLIENT_REVIEW", raisedAt: new Date("2026-09-22"), bomItemId: kitchen.id, programmeImpact: "None, within carpentry stage" },
  });

  // ---- Project 2: Devi, mid-flow (quotes to compare, blockers on the quotation) ---
  const p2 = await prisma.project.create({
    data: {
      code: "PRJ-2026-045",
      name: "Devi Residence, Kitchen and Hall Renovation",
      clientName: "Devi Kumaran",
      clientPhone: "+60 17-654 3321",
      siteAddress: "Kota Kemuning, Selangor",
      propertyType: "Semi-D",
      builtUpArea: "2,600 sq ft",
      budgetMin: 160000,
      budgetMax: 180000,
      surveyAt: new Date("2026-09-12T10:00:00"),
      targetStart: new Date("2026-11-03"),
      targetHandover: new Date("2027-01-30"),
      pmName: "Hafiz",
      stage: "QUOTING",
      leadId: deviLead.id,
    },
  });
  const w2k = await wi(p2.id, 1, "Kitchen");
  const w2h = await wi(p2.id, 2, "Hall");
  const k2 = await addBom(p2.id, w2k.id, 1, { name: "Kitchen cabinet with quartz top", qty: 4200, unit: "mm run", unitCost: 6.2, by: "OUTSOURCED" });
  await rfqFor(p2.id, k2, [
    { vendor: khCarpentry, price: 26800, days: 16, warranty: 24, notes: "On-time history" },
    { vendor: eliteWoodwork, price: 25400, days: 21, warranty: 12, notes: "Lowest price" },
  ]);
  await addBom(p2.id, w2k.id, 2, {
    name: "Kitchen floor tiling",
    qty: 140,
    unit: "sq ft",
    unitCost: 3.5,
    by: "SELF",
    materials: [{ name: "Porcelain tiles", qty: 150, unit: "sq ft", unitCost: 4.4 }, { name: "Adhesive and grout", qty: 5, unit: "bag", unitCost: 22 }],
  });
  await addBom(p2.id, w2h.id, 3, { name: "Wardrobe and TV feature wall", qty: 1, unit: "lot", unitCost: 18500, by: "OUTSOURCED" });
  await addBom(p2.id, w2h.id, 4, { name: "Painting, Hall", qty: 1100, unit: "sq ft", unitCost: 0.9, by: "SELF", materials: [{ name: "Emulsion paint 18L", qty: 4, unit: "pail", unitCost: 240 }] });

  // ---- Pipeline board filler -------------------------------------------------
  const filler = [
    { code: "PRJ-2026-039", name: "Suresh Pillai Residence", clientName: "Suresh Pillai", siteAddress: "Puchong, Selangor", stage: "SITE_VISIT", contractValue: 0 },
    { code: "PRJ-2026-019", name: "Lim W.H. Residence", clientName: "Lim W.H.", siteAddress: "Mont Kiara, KL", stage: "WORK_IN_PROGRESS", contractValue: 216000 },
    { code: "PRJ-2026-014", name: "Chong M.L. Shoplot", clientName: "Chong M.L.", siteAddress: "Puchong, Selangor", stage: "WORK_IN_PROGRESS", contractValue: 179000 },
    { code: "PRJ-2026-002", name: "Raj P. Residence", clientName: "Raj P.", siteAddress: "Sunway Velocity, KL", stage: "COMPLETED", contractValue: 76300 },
    { code: "PRJ-2026-011", name: "Kamal Yusof Residence", clientName: "Kamal Yusof", siteAddress: "Cheras, KL", stage: "CANCELLED", contractValue: 0, cancelReason: "Budget mismatch" },
  ];
  for (const f of filler) await prisma.project.create({ data: { ...f, stageEnteredAt: new Date("2026-08-15") } });

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
