import { t } from '@lingui/core/macro';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title
} from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import {
  IconCheck,
  IconCoins,
  IconExternalLink,
  IconFileInvoice,
  IconPlus,
  IconReceiptTax,
  IconTrash,
  IconTruckDelivery
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { ApiEndpoints } from '@lib/enums/ApiEndpoints';
import { apiUrl } from '@lib/functions/Api';
import { api } from '../../App';

export interface GenerateInvoiceModalProps {
  opened: boolean;
  onClose: () => void;
  order: any;
  onInvoiceGenerated?: (result: any) => void;
}

interface InvoiceLineItem {
  id?: number;
  partId: number;
  partName: string;
  partIPN?: string;
  partDescription?: string;
  units?: string;
  quantity: number;
  unitPrice: number;
  isNew?: boolean;
}

interface InvoiceExtraLineItem {
  id?: number;
  reference: string;
  notes?: string;
  quantity: number;
  price: number;
  isNew?: boolean;
}

// Built-in fallback US state tax rates
const DEFAULT_STATE_TAX_RATES = [
  { state: 'None / Tax Exempt', code: 'EXEMPT', rate: 0.0 },
  { state: 'Virginia', code: 'VA', rate: 5.3 },
  { state: 'California', code: 'CA', rate: 7.25 },
  { state: 'Texas', code: 'TX', rate: 6.25 },
  { state: 'New York', code: 'NY', rate: 4.0 },
  { state: 'Florida', code: 'FL', rate: 6.0 },
  { state: 'Ohio', code: 'OH', rate: 5.75 },
  { state: 'Pennsylvania', code: 'PA', rate: 6.0 },
  { state: 'Illinois', code: 'IL', rate: 6.25 },
  { state: 'North Carolina', code: 'NC', rate: 4.75 },
  { state: 'Georgia', code: 'GA', rate: 4.0 },
  { state: 'Michigan', code: 'MI', rate: 6.0 },
  { state: 'New Jersey', code: 'NJ', rate: 6.625 },
  { state: 'Washington', code: 'WA', rate: 6.5 },
  { state: 'Arizona', code: 'AZ', rate: 5.6 },
  { state: 'Massachusetts', code: 'MA', rate: 6.25 },
  { state: 'Tennessee', code: 'TN', rate: 7.0 },
  { state: 'Indiana', code: 'IN', rate: 7.0 },
  { state: 'Maryland', code: 'MD', rate: 6.0 },
  { state: 'Wisconsin', code: 'WI', rate: 5.0 },
  { state: 'Colorado', code: 'CO', rate: 2.9 },
  { state: 'Minnesota', code: 'MN', rate: 6.875 },
  { state: 'South Carolina', code: 'SC', rate: 6.0 }
];

const DEFAULT_SHIPPING_METHODS = [
  'DHL',
  'FedEx',
  'UPS',
  'USPS',
  'Standard Freight',
  'Customer Pickup',
  'Local Courier'
];

const parsePrice = (val: any): number => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[^0-9.-]+/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  if (typeof val === 'object' && val.amount !== undefined) {
    return Number(val.amount) || 0;
  }
  return 0;
};

export function GenerateInvoiceModal({
  opened,
  onClose,
  order,
  onInvoiceGenerated
}: Readonly<GenerateInvoiceModalProps>) {
  const queryClient = useQueryClient();
  const [loadingData, setLoadingData] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);

  // Form Fields
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [shipMethod, setShipMethod] = useState<string>('FedEx');
  const [shipOptions, setShipOptions] = useState<string[]>(DEFAULT_SHIPPING_METHODS);
  const [newShipMethod, setNewShipMethod] = useState<string>('');
  const [showAddShipMethod, setShowAddShipMethod] = useState<boolean>(false);

  const [taxState, setTaxState] = useState<string>('Virginia');
  const [taxRate, setTaxRate] = useState<number>(5.3);
  const [taxRateOptions, setTaxRateOptions] = useState<
    { state: string; code: string; rate: number }[]
  >(DEFAULT_STATE_TAX_RATES);

  // Line items state
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([]);
  const [extraLines, setExtraLines] = useState<InvoiceExtraLineItem[]>([]);

  // Parts list for adding new line item
  const [partsList, setPartsList] = useState<any[]>([]);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [newLineQty, setNewLineQty] = useState<number>(1);
  const [newLinePrice, setNewLinePrice] = useState<number>(0);
  const [showAddLine, setShowAddLine] = useState<boolean>(false);

  // Extra line item state
  const [newExtraRef, setNewExtraRef] = useState<string>('');
  const [newExtraQty, setNewExtraQty] = useState<number>(1);
  const [newExtraPrice, setNewExtraPrice] = useState<number>(0);
  const [showAddExtra, setShowAddExtra] = useState<boolean>(false);

  // Initialize data when modal opens
  useEffect(() => {
    if (!opened || !order?.pk) return;

    // Dynamic Invoice Number default for multiple invoices
    const existingInvoices = Array.isArray(order.metadata?.invoices)
      ? order.metadata.invoices
      : order.metadata?.invoice
      ? [order.metadata.invoice]
      : [];
    const numPart = order.reference ? order.reference.replace(/^SO-?/i, '') : '0001';

    if (existingInvoices.length > 0) {
      setInvoiceNumber(`INV-${numPart}-${existingInvoices.length + 1}`);
    } else {
      setInvoiceNumber(`INV-${numPart}-1`);
    }

    // Ship Method default
    if (order.metadata?.invoice?.ship_method) {
      setShipMethod(order.metadata.invoice.ship_method);
    } else {
      setShipMethod('FedEx');
    }

    // Tax rate default
    if (order.metadata?.invoice?.tax_rate !== undefined) {
      setTaxRate(Number(order.metadata.invoice.tax_rate));
      setTaxState(order.metadata.invoice.tax_state || 'Virginia');
    } else {
      setTaxRate(5.3);
      setTaxState('Virginia');
    }

    // Load SO lines and extra lines
    setLoadingData(true);
    Promise.all([
      api
        .get(apiUrl(ApiEndpoints.sales_order_line_list), {
          params: { order: order.pk, part_detail: true }
        })
        .catch(() => ({ data: { results: [] } })),
      api
        .get(apiUrl(ApiEndpoints.sales_order_extra_line_list), {
          params: { order: order.pk }
        })
        .catch(() => ({ data: { results: [] } })),
      api
        .get('/api/order/so/tax-rates/')
        .catch(() => ({ data: { results: DEFAULT_STATE_TAX_RATES } })),
      api
        .get('/api/order/so/shipping-methods/')
        .catch(() => ({ data: { results: DEFAULT_SHIPPING_METHODS } })),
      api
        .get(apiUrl(ApiEndpoints.part_list), {
          params: { active: true, limit: 100 }
        })
        .catch(() => ({ data: { results: [] } }))
    ])
      .then(([lineRes, extraRes, taxRes, shipRes, partsRes]) => {
        // Set lines
        const rawLines = lineRes.data?.results ?? lineRes.data ?? [];
        let mappedLines: InvoiceLineItem[] = rawLines.map((l: any) => ({
          id: l.pk,
          partId: l.part,
          partName: l.part_detail?.name || l.part_detail?.full_name || `Part #${l.part}`,
          partIPN: l.part_detail?.IPN || '',
          partDescription: l.part_detail?.description || '',
          units: l.part_detail?.units || 'pcs',
          quantity: Number(l.quantity) || 1,
          unitPrice: parsePrice(
            l.sale_price ??
              l.price ??
              l.part_detail?.selling_price ??
              l.part_detail?.pricing_min ??
              l.part_detail?.cost ??
              0
          )
        }));

        // Merge any additional items previously saved in invoice metadata for this order
        if (Array.isArray(order.metadata?.invoice?.items) && order.metadata.invoice.items.length > mappedLines.length) {
          const dbPartIds = new Set(mappedLines.map((l) => l.partId));
          const extraSavedItems = order.metadata.invoice.items
            .filter((it: any) => it.part_id && !dbPartIds.has(it.part_id))
            .map((it: any, idx: number) => ({
              id: -(idx + 1),
              partId: it.part_id,
              partName: it.part_name,
              partIPN: it.part_ipn || '',
              partDescription: it.description || '',
              units: it.units || 'pcs',
              quantity: Number(it.quantity) || 1,
              unitPrice: parsePrice(it.unit_price),
              isNew: true
            }));
          mappedLines = [...mappedLines, ...extraSavedItems];
        }
        setLineItems(mappedLines);

        // Set extra lines:
        // Only pre-populate order-level extra lines for the very first invoice (e.g. INV-xxx-1).
        // For subsequent invoices (INV-xxx-2, INV-xxx-3, etc.), extra charges start empty
        // so that one-off freight/service charges from previous invoices do not carry over automatically.
        if (existingInvoices.length === 0) {
          const rawExtras = extraRes.data?.results ?? extraRes.data ?? [];
          let mappedExtras: InvoiceExtraLineItem[] = rawExtras.map((el: any) => ({
            id: el.pk,
            reference: el.reference || el.description || 'Additional Charge',
            notes: el.notes || '',
            quantity: Number(el.quantity) || 1,
            price: parsePrice(el.price ?? el.total_price)
          }));

          // Load any saved extra charges from metadata if not present in DB
          if (mappedExtras.length === 0 && Array.isArray(order.metadata?.invoice?.extra_items)) {
            mappedExtras = order.metadata.invoice.extra_items.map((ex: any, idx: number) => ({
              id: -(idx + 1),
              reference: ex.description || 'Additional Charge',
              notes: ex.notes || '',
              quantity: Number(ex.quantity) || 1,
              price: parsePrice(ex.unit_price ?? ex.price ?? ex.total_price),
              isNew: true
            }));
          }
          setExtraLines(mappedExtras);
        } else {
          setExtraLines([]);
        }

        // Set Tax rates
        const taxes = taxRes.data?.results ?? DEFAULT_STATE_TAX_RATES;
        if (Array.isArray(taxes) && taxes.length > 0) {
          setTaxRateOptions(taxes);
        }

        // Set shipping methods
        const methods = shipRes.data?.results ?? DEFAULT_SHIPPING_METHODS;
        if (Array.isArray(methods) && methods.length > 0) {
          setShipOptions(methods);
        }

        // Set parts
        const parts = partsRes.data?.results ?? partsRes.data ?? [];
        setPartsList(parts);
      })
      .finally(() => {
        setLoadingData(false);
      });
  }, [opened, order?.pk]);

  // Handle Tax Rate selection change
  const handleTaxSelection = useCallback(
    (selectedStateName: string | null) => {
      if (!selectedStateName) return;
      const found = taxRateOptions.find((t) => t.state === selectedStateName);
      if (found) {
        setTaxState(found.state);
        setTaxRate(found.rate);
      }
    },
    [taxRateOptions]
  );

  // Handle Add custom ship method
  const handleAddShipMethod = useCallback(() => {
    if (!newShipMethod.trim()) return;
    const trimmed = newShipMethod.trim();
    if (!shipOptions.includes(trimmed)) {
      setShipOptions((prev) => [...prev, trimmed]);
    }
    setShipMethod(trimmed);
    setNewShipMethod('');
    setShowAddShipMethod(false);
  }, [newShipMethod, shipOptions]);

  // Handle selecting part to auto-fill default price
  const handleSelectPart = useCallback(
    (id: string | null) => {
      setSelectedPartId(id);
      if (!id) return;
      const part = partsList.find((p) => String(p.pk) === id);
      if (part) {
        const p = parsePrice(part.pricing_min ?? part.price ?? part.salable_price ?? 0);
        if (p > 0) {
          setNewLinePrice(p);
        }
      }
    },
    [partsList]
  );

  // Add line item
  const handleAddLineItem = useCallback(() => {
    if (!selectedPartId) return;
    const part = partsList.find((p) => String(p.pk) === selectedPartId);
    if (!part) return;

    const newItem: InvoiceLineItem = {
      partId: part.pk,
      partName: part.name || part.full_name,
      partIPN: part.IPN || '',
      partDescription: part.description || '',
      units: part.units || 'pcs',
      quantity: newLineQty,
      unitPrice: newLinePrice,
      isNew: true
    };

    setLineItems((prev) => [...prev, newItem]);
    setSelectedPartId(null);
    setNewLineQty(1);
    setNewLinePrice(0);
    setShowAddLine(false);
  }, [selectedPartId, partsList, newLineQty, newLinePrice]);

  // Add extra line item
  const handleAddExtraLineItem = useCallback(() => {
    if (!newExtraRef.trim()) return;

    const newExtra: InvoiceExtraLineItem = {
      reference: newExtraRef.trim(),
      quantity: newExtraQty,
      price: newExtraPrice,
      isNew: true
    };

    setExtraLines((prev) => [...prev, newExtra]);
    setNewExtraRef('');
    setNewExtraQty(1);
    setNewExtraPrice(0);
    setShowAddExtra(false);
  }, [newExtraRef, newExtraQty, newExtraPrice]);

  // Remove line item
  const handleRemoveLine = useCallback((index: number) => {
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Remove extra line item
  const handleRemoveExtra = useCallback((index: number) => {
    setExtraLines((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Calculate live totals
  const subtotal: number = useMemo(() => {
    const linesTotal = lineItems.reduce(
      (acc, item) => acc + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0),
      0
    );
    const extrasTotal = extraLines.reduce(
      (acc, item) => acc + (Number(item.quantity) || 0) * (Number(item.price) || 0),
      0
    );
    return Number((linesTotal + extrasTotal).toFixed(2));
  }, [lineItems, extraLines]);

  const taxAmount: number = useMemo(() => {
    return Number(((subtotal * (Number(taxRate) || 0)) / 100).toFixed(2));
  }, [subtotal, taxRate]);

  const totalAmountDue: number = useMemo(() => {
    return Number((subtotal + taxAmount).toFixed(2));
  }, [subtotal, taxAmount]);

  // Handle Generate Invoice Submit
  const handleGenerateInvoice = useCallback(async () => {
    if (!order?.pk) return;
    setGenerating(true);

    try {
      // Generate invoice via endpoint (backend atomically creates any newly added lines and extra lines)
      const invoicePayload = {
        invoice_number: invoiceNumber || order.reference,
        ship_method: shipMethod,
        tax_rate: taxRate,
        tax_state: taxState,
        tax_amount: taxAmount,
        subtotal: subtotal,
        total_amount_due: totalAmountDue,
        items: lineItems.map((item, idx) => ({
          line_number: idx + 1,
          id: item.id,
          part_id: item.partId,
          part_name: item.partName,
          part_ipn: item.partIPN || '',
          description: item.partDescription || item.partName || '',
          units: item.units || 'pcs',
          quantity: item.quantity,
          unit_price: item.unitPrice,
          total_price: Number(((item.quantity || 0) * (item.unitPrice || 0)).toFixed(2)),
          is_new: Boolean(item.isNew)
        })),
        extra_items: extraLines.map((extra, idx) => ({
          line_number: idx + 1,
          id: extra.id,
          description: extra.reference || 'Additional Charge',
          reference: extra.reference || 'Additional Charge',
          notes: extra.notes || '',
          quantity: extra.quantity,
          unit_price: extra.price,
          price: extra.price,
          total_price: Number(((extra.quantity || 0) * (extra.price || 0)).toFixed(2)),
          is_new: Boolean(extra.isNew)
        }))
      };

      const res = await api.post(
        `/api/order/so/${order.pk}/generate-invoice/`,
        invoicePayload
      );

      // Invalidate all table data queries so Line Items and Extra Line Items tables immediately reload
      queryClient.invalidateQueries({ queryKey: ['tabledata'] });

      showNotification({
        title: t`Invoice Generated`,
        message: t`Invoice ${invoicePayload.invoice_number} created successfully`,
        color: 'green',
        icon: <IconCheck size={18} />
      });

      // Open generated invoice preview in a new window/tab
      if (res.data?.output_url) {
        window.open(res.data.output_url, '_blank');
      }

      if (onInvoiceGenerated) {
        onInvoiceGenerated(res.data);
      }

      onClose();
    } catch (err: any) {
      console.error('Invoice generation failed:', err);
      showNotification({
        title: t`Generation Error`,
        message:
          err?.response?.data?.error ||
          err?.message ||
          t`Failed to generate invoice`,
        color: 'red'
      });
    } finally {
      setGenerating(false);
    }
  }, [
    order?.pk,
    order?.reference,
    lineItems,
    extraLines,
    invoiceNumber,
    shipMethod,
    taxRate,
    taxState,
    taxAmount,
    subtotal,
    totalAmountDue,
    onInvoiceGenerated,
    onClose,
    queryClient
  ]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap='xs'>
          <ThemeIcon size='md' radius='md' color='blue' variant='light'>
            <IconFileInvoice size={20} />
          </ThemeIcon>
          <Title order={4}>
            {t`Generate Invoice`} &mdash; {order?.reference}
          </Title>
        </Group>
      }
      size='xl'
      padding='lg'
    >
      {loadingData ? (
        <Stack align='center' py='xl'>
          <Loader size='md' />
          <Text size='sm' c='dimmed'>{t`Loading order details and line items...`}</Text>
        </Stack>
      ) : (
        <Stack gap='md'>
          {/* Top Invoice Configuration Fields */}
          <Paper p='sm' withBorder radius='md' bg='gray.0'>
            <Grid gap='md'>
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <TextInput
                  label={t`Invoice Number`}
                  description={t`Auto-generated or custom reference`}
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.currentTarget.value)}
                  placeholder='INV-0001'
                  required
                />
              </Grid.Col>

              <Grid.Col span={{ base: 12, sm: 4 }}>
                <Select
                  label={t`Ship Method`}
                  description={t`Carrier or delivery route`}
                  data={shipOptions.map((opt) => ({ value: opt, label: opt }))}
                  value={shipMethod}
                  onChange={(val) => val && setShipMethod(val)}
                  leftSection={<IconTruckDelivery size={16} />}
                  required
                />
                {!showAddShipMethod ? (
                  <Button
                    variant='subtle'
                    size='compact-xs'
                    mt={4}
                    onClick={() => setShowAddShipMethod(true)}
                  >
                    {t`+ Add custom method`}
                  </Button>
                ) : (
                  <Group gap='xs' mt={6}>
                    <TextInput
                      size='xs'
                      placeholder='Custom carrier name'
                      value={newShipMethod}
                      onChange={(e) => setNewShipMethod(e.currentTarget.value)}
                      style={{ flex: 1 }}
                    />
                    <Button size='xs' onClick={handleAddShipMethod}>
                      {t`Add`}
                    </Button>
                    <Button
                      size='xs'
                      variant='default'
                      onClick={() => setShowAddShipMethod(false)}
                    >
                      {t`Cancel`}
                    </Button>
                  </Group>
                )}
              </Grid.Col>

              <Grid.Col span={{ base: 12, sm: 4 }}>
                <Select
                  label={t`State Sales Tax Rate`}
                  description={t`State rate applied to subtotal`}
                  data={taxRateOptions.map((opt) => ({
                    value: opt.state,
                    label: `${opt.state} (${opt.rate}%)`
                  }))}
                  value={taxState}
                  onChange={handleTaxSelection}
                  leftSection={<IconReceiptTax size={16} />}
                  required
                />
                <Group gap='xs' mt={4}>
                  <Text size='xs' c='dimmed'>{t`Selected Tax Rate:`}</Text>
                  <Badge size='sm' variant='filled' color='blue'>
                    {taxRate}%
                  </Badge>
                </Group>
              </Grid.Col>
            </Grid>

            {/* Customer Details Row */}
            <Divider my='sm' />
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing='xs'>
              <div>
                <Text size='xs' c='dimmed'>{t`Customer`}:</Text>
                <Text size='sm' fw={600}>{order?.customer_detail?.name || t`Direct Customer`}</Text>
              </div>
              <div>
                <Text size='xs' c='dimmed'>{t`Order Date`}:</Text>
                <Text size='sm'>{order?.creation_date || t`Current Date`}</Text>
              </div>
              <div>
                <Text size='xs' c='dimmed'>{t`Customer PO Ref`}:</Text>
                <Text size='sm'>{order?.customer_reference || '-'}</Text>
              </div>
            </SimpleGrid>
          </Paper>

          {/* Line Items Section */}
          <Paper p='sm' withBorder radius='md'>
            <Group justify='space-between' mb='xs'>
              <Group gap='xs'>
                <Title order={5}>{t`Line Items`}</Title>
                <Badge size='sm' variant='light'>
                  {lineItems.length}
                </Badge>
              </Group>
              <Button
                size='xs'
                variant='light'
                leftSection={<IconPlus size={14} />}
                onClick={() => setShowAddLine(!showAddLine)}
              >
                {t`Add Line Item`}
              </Button>
            </Group>

            {/* Add Line Item Mini-Form */}
            {showAddLine && (
              <Card p='xs' mb='sm' withBorder bg='blue.0'>
                <Grid gap='xs' align='flex-end'>
                  <Grid.Col span={{ base: 12, sm: 5 }}>
                    <Select
                      size='xs'
                      label={t`Select Part`}
                      placeholder={t`Choose part to add`}
                      data={partsList.map((p) => ({
                        value: String(p.pk),
                        label: `${p.IPN ? p.IPN + ' - ' : ''}${p.name}`
                      }))}
                      value={selectedPartId}
                      onChange={handleSelectPart}
                      searchable
                      required
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 6, sm: 2 }}>
                    <NumberInput
                      size='xs'
                      label={t`Quantity`}
                      value={newLineQty}
                      onChange={(v) => setNewLineQty(Number(v) || 1)}
                      min={1}
                      required
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 6, sm: 2 }}>
                    <NumberInput
                      size='xs'
                      label={t`Unit Price ($)`}
                      value={newLinePrice}
                      onChange={(v) => setNewLinePrice(Number(v) || 0)}
                      min={0}
                      decimalScale={2}
                      required
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, sm: 3 }}>
                    <Group gap='xs'>
                      <Button
                        size='xs'
                        color='blue'
                        disabled={!selectedPartId}
                        onClick={handleAddLineItem}
                      >
                        {t`Add`}
                      </Button>
                      <Button
                        size='xs'
                        variant='default'
                        onClick={() => setShowAddLine(false)}
                      >
                        {t`Cancel`}
                      </Button>
                    </Group>
                  </Grid.Col>
                </Grid>
              </Card>
            )}

            <Table striped highlightOnHover withTableBorder withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t`Item / Part`}</Table.Th>
                  <Table.Th style={{ width: 80, textAlign: 'center' }}>{t`UOM`}</Table.Th>
                  <Table.Th style={{ width: 110, textAlign: 'right' }}>{t`Qty`}</Table.Th>
                  <Table.Th style={{ width: 130, textAlign: 'right' }}>{t`Unit Price`}</Table.Th>
                  <Table.Th style={{ width: 140, textAlign: 'right' }}>{t`Extended Price`}</Table.Th>
                  <Table.Th style={{ width: 50, textAlign: 'center' }}></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {lineItems.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={6} style={{ textAlign: 'center', color: '#888' }}>
                      {t`No line items in this invoice`}
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  lineItems.map((item, idx) => (
                    <Table.Tr key={`line-${item.id || idx}`}>
                      <Table.Td>
                        <Text fw={600} size='sm'>
                          {item.partName}
                        </Text>
                        {item.partIPN && (
                          <Text size='xs' c='dimmed'>
                            IPN: {item.partIPN}
                          </Text>
                        )}
                        {item.isNew && (
                          <Badge size='xs' color='teal' variant='light' ml={4}>
                            {t`New`}
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'center' }}>
                        <Text size='xs'>{item.units || 'EA'}</Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <NumberInput
                          size='xs'
                          value={item.quantity}
                          onChange={(val) => {
                            const updated = [...lineItems];
                            updated[idx].quantity = Number(val) || 0;
                            setLineItems(updated);
                          }}
                          min={1}
                        />
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <NumberInput
                          size='xs'
                          value={item.unitPrice}
                          onChange={(val) => {
                            const updated = [...lineItems];
                            updated[idx].unitPrice = Number(val) || 0;
                            setLineItems(updated);
                          }}
                          min={0}
                          decimalScale={2}
                          prefix='$'
                        />
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right', fontWeight: 600 }}>
                        ${((item.quantity || 0) * (item.unitPrice || 0)).toFixed(2)}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'center' }}>
                        <ActionIcon
                          size='sm'
                          color='red'
                          variant='subtle'
                          onClick={() => handleRemoveLine(idx)}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Table.Td>
                    </Table.Tr>
                  ))
                )}
              </Table.Tbody>
            </Table>
          </Paper>

          {/* Extra Line Items Section */}
          <Paper p='sm' withBorder radius='md'>
            <Group justify='space-between' mb='xs'>
              <Group gap='xs'>
                <Title order={5}>{t`Extra Line Items & Charges`}</Title>
                <Badge size='sm' variant='light' color='orange'>
                  {extraLines.length}
                </Badge>
              </Group>
              <Button
                size='xs'
                variant='light'
                color='orange'
                leftSection={<IconPlus size={14} />}
                onClick={() => setShowAddExtra(!showAddExtra)}
              >
                {t`Add Extra Charge`}
              </Button>
            </Group>

            {/* Add Extra Line Mini-Form */}
            {showAddExtra && (
              <Card p='xs' mb='sm' withBorder bg='orange.0'>
                <Grid gap='xs' align='flex-end'>
                  <Grid.Col span={{ base: 12, sm: 5 }}>
                    <TextInput
                      size='xs'
                      label={t`Charge Description`}
                      placeholder='e.g. Freight Delivery, Handling, Expedited'
                      value={newExtraRef}
                      onChange={(e) => setNewExtraRef(e.currentTarget.value)}
                      required
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 6, sm: 2 }}>
                    <NumberInput
                      size='xs'
                      label={t`Quantity`}
                      value={newExtraQty}
                      onChange={(v) => setNewExtraQty(Number(v) || 1)}
                      min={1}
                      required
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 6, sm: 2 }}>
                    <NumberInput
                      size='xs'
                      label={t`Price ($)`}
                      value={newExtraPrice}
                      onChange={(v) => setNewExtraPrice(Number(v) || 0)}
                      min={0}
                      decimalScale={2}
                      required
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, sm: 3 }}>
                    <Group gap='xs'>
                      <Button
                        size='xs'
                        color='orange'
                        disabled={!newExtraRef.trim()}
                        onClick={handleAddExtraLineItem}
                      >
                        {t`Add`}
                      </Button>
                      <Button
                        size='xs'
                        variant='default'
                        onClick={() => setShowAddExtra(false)}
                      >
                        {t`Cancel`}
                      </Button>
                    </Group>
                  </Grid.Col>
                </Grid>
              </Card>
            )}

            <Table striped highlightOnHover withTableBorder withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t`Description`}</Table.Th>
                  <Table.Th style={{ width: 110, textAlign: 'right' }}>{t`Qty`}</Table.Th>
                  <Table.Th style={{ width: 130, textAlign: 'right' }}>{t`Price`}</Table.Th>
                  <Table.Th style={{ width: 140, textAlign: 'right' }}>{t`Total`}</Table.Th>
                  <Table.Th style={{ width: 50, textAlign: 'center' }}></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {extraLines.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={5} style={{ textAlign: 'center', color: '#888' }}>
                      {t`No extra line items in this invoice`}
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  extraLines.map((extra, idx) => (
                    <Table.Tr key={`extra-${extra.id || idx}`}>
                      <Table.Td>
                        <TextInput
                          size='xs'
                          value={extra.reference}
                          onChange={(e) => {
                            const updated = [...extraLines];
                            updated[idx].reference = e.currentTarget.value;
                            setExtraLines(updated);
                          }}
                        />
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <NumberInput
                          size='xs'
                          value={extra.quantity}
                          onChange={(val) => {
                            const updated = [...extraLines];
                            updated[idx].quantity = Number(val) || 0;
                            setExtraLines(updated);
                          }}
                          min={1}
                        />
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <NumberInput
                          size='xs'
                          value={extra.price}
                          onChange={(val) => {
                            const updated = [...extraLines];
                            updated[idx].price = Number(val) || 0;
                            setExtraLines(updated);
                          }}
                          min={0}
                          decimalScale={2}
                          prefix='$'
                        />
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right', fontWeight: 600 }}>
                        ${((extra.quantity || 0) * (extra.price || 0)).toFixed(2)}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'center' }}>
                        <ActionIcon
                          size='sm'
                          color='red'
                          variant='subtle'
                          onClick={() => handleRemoveExtra(idx)}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Table.Td>
                    </Table.Tr>
                  ))
                )}
              </Table.Tbody>
            </Table>
          </Paper>

          {/* Totals Summary Card */}
          <Paper p='md' withBorder radius='md' bg='slate.0'>
            <Group justify='space-between' align='flex-end'>
              <div>
                <Text size='sm' c='dimmed'>{t`Total Items & Charges`}:</Text>
                <Text size='sm' fw={600}>
                  {lineItems.length} {t`line items`} + {extraLines.length} {t`extra charges`}
                </Text>
              </div>

              <Stack gap={4} style={{ minWidth: 260 }}>
                <Group justify='space-between'>
                  <Text size='sm' fw={600}>{t`SUB-TOTAL:`}</Text>
                  <Text size='sm' fw={700}>
                    ${subtotal.toFixed(2)}
                  </Text>
                </Group>
                <Group justify='space-between'>
                  <Text size='sm' c='dimmed'>
                    {t`TAX (${taxRate}% ${taxState}):`}
                  </Text>
                  <Text size='sm' fw={600}>
                    ${taxAmount.toFixed(2)}
                  </Text>
                </Group>
                <Divider my={2} />
                <Group justify='space-between'>
                  <Text size='md' fw={800} c='blue.8'>
                    {t`AMOUNT DUE:`}
                  </Text>
                  <Text size='lg' fw={900} c='blue.8'>
                    ${totalAmountDue.toFixed(2)}
                  </Text>
                </Group>
              </Stack>
            </Group>
          </Paper>

          {/* Bottom Action Footer */}
          <Group justify='space-between' pt='sm'>
            <Button variant='default' onClick={onClose}>
              {t`Cancel`}
            </Button>
            <Button
              size='md'
              color='blue'
              leftSection={<IconFileInvoice size={20} />}
              loading={generating}
              onClick={handleGenerateInvoice}
            >
              {t`Generate Invoice`}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
