/**
 * Multi-format business & accounting report generator.
 * Uses dynamic imports so XLSX / jsPDF / DOCX stay out of the main admin bundle.
 */

export type ReportFormat = 'csv' | 'xlsx' | 'pdf' | 'docx';

export interface BusinessReportPayload {
  summary: {
    generatedAt: string;
    from: string;
    to: string;
    totalOrders: number;
    realizedOrders: number;
    cancelledOrders: number;
    grossSubtotalRupees: number;
    discountTotalRupees: number;
    shippingTotalRupees: number;
    codFeeTotalRupees: number;
    netRevenueRupees: number;
    prepaidOrders: number;
    prepaidRevenueRupees: number;
    codOrders: number;
    codRevenueRupees: number;
    aovRupees: number;
  };
  orders: Array<{
    orderNumber: string;
    date: string;
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    location: string;
    paymentMethod: string;
    paymentStatus: string;
    orderStatus: string;
    couponCode: string;
    subtotalRupees: number;
    discountRupees: number;
    shippingRupees: number;
    codFeeRupees: number;
    netTotalRupees: number;
    itemsSummary: string;
  }>;
  skuBreakdown: Array<{
    productName: string;
    size: string;
    quantitySold: number;
    grossRevenueRupees: number;
  }>;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function formatDateTag(iso: string): string {
  return iso.slice(0, 10);
}

function formatInr(n: number): string {
  return `INR ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeCsvCell(v: unknown): string {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildSummaryRows(s: BusinessReportPayload['summary']): Array<[string, string | number]> {
  return [
    ['Report Period Start', formatDateTag(s.from)],
    ['Report Period End', formatDateTag(s.to)],
    ['Total Orders', s.totalOrders],
    ['Realized (Confirmed/Active) Orders', s.realizedOrders],
    ['Cancelled Orders', s.cancelledOrders],
    ['Gross Merchandise Value (Rs)', s.grossSubtotalRupees],
    ['Discounts & Coupons Given (Rs)', s.discountTotalRupees],
    ['Shipping Collected (Rs)', s.shippingTotalRupees],
    ['COD Handling Fees Collected (Rs)', s.codFeeTotalRupees],
    ['Net Revenue (Rs)', s.netRevenueRupees],
    ['Average Order Value (Rs)', s.aovRupees],
    ['Prepaid Orders', `${s.prepaidOrders} (${formatInr(s.prepaidRevenueRupees)})`],
    ['COD Orders', `${s.codOrders} (${formatInr(s.codRevenueRupees)})`],
  ];
}

export async function downloadBusinessReport(
  data: BusinessReportPayload,
  format: ReportFormat,
): Promise<void> {
  const tag = `${formatDateTag(data.summary.from)}_to_${formatDateTag(data.summary.to)}`;
  const baseName = `kickoffpro-report-${tag}`;

  if (format === 'csv') {
    const lines: string[] = [];
    lines.push('EXECUTIVE SUMMARY KPI');
    lines.push('Metric,Value');
    for (const [k, v] of buildSummaryRows(data.summary)) {
      lines.push(`${escapeCsvCell(k)},${escapeCsvCell(v)}`);
    }
    lines.push('');
    lines.push('ORDERS ACCOUNTING LEDGER');
    lines.push(
      [
        'Order Number',
        'Date (IST)',
        'Customer',
        'Phone',
        'Email',
        'Location',
        'Payment Method',
        'Payment Status',
        'Order Status',
        'Coupon',
        'Gross (Rs)',
        'Discount (Rs)',
        'Shipping (Rs)',
        'COD Fee (Rs)',
        'Net Total (Rs)',
        'Items / Sizes',
      ]
        .map(escapeCsvCell)
        .join(','),
    );
    for (const o of data.orders) {
      lines.push(
        [
          o.orderNumber,
          o.date,
          o.customerName,
          o.customerPhone,
          o.customerEmail,
          o.location,
          o.paymentMethod,
          o.paymentStatus,
          o.orderStatus,
          o.couponCode,
          o.subtotalRupees,
          o.discountRupees,
          o.shippingRupees,
          o.codFeeRupees,
          o.netTotalRupees,
          o.itemsSummary,
        ]
          .map(escapeCsvCell)
          .join(','),
      );
    }
    lines.push('');
    lines.push('SKU & SIZE BREAKDOWN (REALIZED ORDERS)');
    lines.push('Product Name,Size,Quantity Sold,Gross Revenue (Rs)');
    for (const sku of data.skuBreakdown) {
      lines.push(
        [sku.productName, sku.size, sku.quantitySold, sku.grossRevenueRupees]
          .map(escapeCsvCell)
          .join(','),
      );
    }
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    triggerBlobDownload(blob, `${baseName}.csv`);
    return;
  }

  if (format === 'xlsx') {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();

    const summarySheet = XLSX.utils.aoa_to_sheet([
      ['Metric', 'Value'],
      ...buildSummaryRows(data.summary),
    ]);
    summarySheet['!cols'] = [{ wch: 36 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary KPIs');

    const orderSheet = XLSX.utils.json_to_sheet(
      data.orders.map((o) => ({
        'Order Number': o.orderNumber,
        'Date (IST)': o.date,
        Customer: o.customerName,
        Phone: o.customerPhone,
        Email: o.customerEmail,
        Location: o.location,
        Payment: o.paymentMethod,
        'Payment Status': o.paymentStatus,
        'Order Status': o.orderStatus,
        Coupon: o.couponCode,
        'Gross (Rs)': o.subtotalRupees,
        'Discount (Rs)': o.discountRupees,
        'Shipping (Rs)': o.shippingRupees,
        'COD Fee (Rs)': o.codFeeRupees,
        'Net Total (Rs)': o.netTotalRupees,
        'Items / Sizes': o.itemsSummary,
      })),
    );
    XLSX.utils.book_append_sheet(wb, orderSheet, 'Orders Ledger');

    const skuSheet = XLSX.utils.json_to_sheet(
      data.skuBreakdown.map((s) => ({
        Product: s.productName,
        Size: s.size,
        'Units Sold': s.quantitySold,
        'Gross Revenue (Rs)': s.grossRevenueRupees,
      })),
    );
    XLSX.utils.book_append_sheet(wb, skuSheet, 'SKU & Size Breakdown');

    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    triggerBlobDownload(
      new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      `${baseName}.xlsx`,
    );
    return;
  }

  if (format === 'pdf') {
    const { jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    doc.setFontSize(16);
    doc.text('Executive Business & Accounting Report', 40, 42);
    doc.setFontSize(9.5);
    doc.setTextColor(100);
    doc.text(
      `Period: ${formatDateTag(data.summary.from)} to ${formatDateTag(data.summary.to)}   |   Generated: ${new Date(data.summary.generatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
      40,
      60,
    );

    autoTable(doc, {
      startY: 76,
      head: [['KPI Metric', 'Value']],
      body: buildSummaryRows(data.summary).map(([k, v]) => [k, String(v)]),
      styles: { fontSize: 8.5, cellPadding: 4 },
      headStyles: { fillColor: [15, 23, 42] },
      margin: { left: 40, right: 40 },
    });

    const afterSummaryY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 260) + 18;
    doc.setFontSize(12);
    doc.setTextColor(15);
    doc.text('SKU & Size Breakdown (Realized Orders)', 40, afterSummaryY);

    autoTable(doc, {
      startY: afterSummaryY + 8,
      head: [['Product', 'Size', 'Units Sold', 'Gross Revenue (Rs)']],
      body:
        data.skuBreakdown.length > 0
          ? data.skuBreakdown.map((s) => [
              s.productName,
              s.size,
              String(s.quantitySold),
              s.grossRevenueRupees.toFixed(2),
            ])
          : [['No realized SKU sales in range', '-', '0', '0.00']],
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [30, 41, 59] },
      margin: { left: 40, right: 40 },
    });

    doc.addPage();
    doc.setFontSize(13);
    doc.text('Orders Accounting Ledger', 40, 40);
    autoTable(doc, {
      startY: 52,
      head: [
        [
          'Order #',
          'Date',
          'Customer',
          'Payment',
          'Status',
          'Coupon',
          'Gross',
          'Disc.',
          'Ship',
          'COD Fee',
          'Net (Rs)',
          'Items',
        ],
      ],
      body: data.orders.map((o) => [
        o.orderNumber,
        o.date,
        `${o.customerName}${o.customerPhone ? ` (${o.customerPhone})` : ''}`,
        `${o.paymentMethod} / ${o.paymentStatus}`,
        o.orderStatus,
        o.couponCode || '-',
        o.subtotalRupees.toFixed(2),
        o.discountRupees.toFixed(2),
        o.shippingRupees.toFixed(2),
        o.codFeeRupees.toFixed(2),
        o.netTotalRupees.toFixed(2),
        o.itemsSummary,
      ]),
      styles: { fontSize: 7, cellPadding: 3 },
      headStyles: { fillColor: [15, 23, 42] },
      margin: { left: 28, right: 28 },
    });

    doc.save(`${baseName}.pdf`);
    return;
  }

  // Word (.docx)
  const {
    Document,
    Packer,
    Paragraph,
    Table,
    TableRow,
    TableCell,
    TextRun,
    HeadingLevel,
    WidthType,
  } = await import('docx');

  const makeRow = (cells: string[], bold = false) =>
    new TableRow({
      children: cells.map(
        (text) =>
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text, bold, size: 18 })],
              }),
            ],
          }),
      ),
    });

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            text: 'Executive Business & Accounting Report',
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            text: `Period: ${formatDateTag(data.summary.from)} to ${formatDateTag(data.summary.to)} | Generated: ${new Date(data.summary.generatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
          }),
          new Paragraph({ text: '' }),
          new Paragraph({ text: 'Summary KPIs', heading: HeadingLevel.HEADING_2 }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              makeRow(['Metric', 'Value'], true),
              ...buildSummaryRows(data.summary).map(([k, v]) => makeRow([k, String(v)])),
            ],
          }),
          new Paragraph({ text: '' }),
          new Paragraph({ text: 'SKU & Size Breakdown', heading: HeadingLevel.HEADING_2 }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              makeRow(['Product', 'Size', 'Units Sold', 'Gross Revenue (Rs)'], true),
              ...data.skuBreakdown.map((s) =>
                makeRow([
                  s.productName,
                  s.size,
                  String(s.quantitySold),
                  s.grossRevenueRupees.toFixed(2),
                ]),
              ),
            ],
          }),
          new Paragraph({ text: '' }),
          new Paragraph({ text: 'Orders Ledger', heading: HeadingLevel.HEADING_2 }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              makeRow(
                ['Order #', 'Customer', 'Payment', 'Status', 'Net (Rs)', 'Items'],
                true,
              ),
              ...data.orders.map((o) =>
                makeRow([
                  o.orderNumber,
                  `${o.customerName} (${o.customerPhone})`,
                  `${o.paymentMethod}/${o.paymentStatus}`,
                  o.orderStatus,
                  o.netTotalRupees.toFixed(2),
                  o.itemsSummary,
                ]),
              ),
            ],
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  triggerBlobDownload(blob, `${baseName}.docx`);
}
