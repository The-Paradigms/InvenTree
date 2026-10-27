import { t } from '@lingui/core/macro';
import {
  Accordion,
  ActionIcon,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
  Tooltip
} from '@mantine/core';
import {
  IconCalendar,
  IconCheck,
  IconCoins,
  IconDownload,
  IconExternalLink,
  IconEye,
  IconFileInvoice,
  IconPlus,
  IconPrinter,
  IconReceiptTax,
  IconRefresh,
  IconTruckDelivery
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../App';

export interface SalesOrderInvoicePanelProps {
  order: any;
  onOpenModal: () => void;
  refreshOrder?: () => void;
}

export function SalesOrderInvoicePanel({
  order,
  onOpenModal,
  refreshOrder
}: Readonly<SalesOrderInvoicePanelProps>) {
  const [loading, setLoading] = useState<boolean>(false);
  const [localOrder, setLocalOrder] = useState<any>(order);
  const [htmlCache, setHtmlCache] = useState<Record<string, string>>({});
  const [loadingHtml, setLoadingHtml] = useState<Record<string, boolean>>({});
  const initializedOrderPk = useRef<number | null>(null);

  // Sync prop changes
  useEffect(() => {
    if (order) {
      setLocalOrder(order);
    }
  }, [order]);

  // Extract list of all invoices (supporting both new invoices list and single invoice)
  const invoicesList: any[] = useMemo(() => {
    const raw = localOrder?.metadata?.invoices;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw;
    }
    if (
      localOrder?.metadata?.invoice &&
      typeof localOrder.metadata.invoice === 'object'
    ) {
      return [localOrder.metadata.invoice];
    }
    return [];
  }, [localOrder?.metadata]);

  // Active expanded accordion item (can be null when user collapses all)
  const [expandedInvoice, setExpandedInvoice] = useState<string | null>(
    invoicesList[0]?.invoice_number || null
  );

  // Auto-expand the newest invoice only once per sales order on initial load
  useEffect(() => {
    if (order?.pk && initializedOrderPk.current !== order.pk && invoicesList.length > 0) {
      initializedOrderPk.current = order.pk;
      setExpandedInvoice(invoicesList[0]?.invoice_number || null);
    }
  }, [order?.pk, invoicesList]);

  // Fetch rendered HTML for an invoice
  const fetchInvoiceHtml = useCallback(
    (invNum: string) => {
      if (!localOrder?.pk || !invNum) return;
      setLoadingHtml((prev) => ({ ...prev, [invNum]: true }));
      api
        .get(`/api/order/so/${localOrder.pk}/invoice-content/`, {
          params: { invoice_number: invNum }
        })
        .then((res) => {
          if (res.data?.html) {
            setHtmlCache((prev) => ({ ...prev, [invNum]: res.data.html }));
          }
        })
        .catch((err) => {
          console.warn(`Failed to fetch HTML for ${invNum}:`, err);
        })
        .finally(() => {
          setLoadingHtml((prev) => ({ ...prev, [invNum]: false }));
        });
    },
    [localOrder?.pk]
  );

  // Pre-fetch HTML for all invoices so previews open instantly when clicked
  useEffect(() => {
    if (localOrder?.pk && invoicesList.length > 0) {
      invoicesList.forEach((inv) => {
        const num = inv.invoice_number;
        if (num && !htmlCache[num]) {
          fetchInvoiceHtml(num);
        }
      });
    }
  }, [localOrder?.pk, invoicesList, htmlCache, fetchInvoiceHtml]);

  // Refresh order data
  const handleRefresh = useCallback(() => {
    if (!order?.pk) return;
    setLoading(true);
    api
      .get(`/api/order/so/${order.pk}/`)
      .then((res) => {
        if (res.data) {
          setLocalOrder(res.data);
          const invList = res.data?.metadata?.invoices || (res.data?.metadata?.invoice ? [res.data.metadata.invoice] : []);
          if (invList.length > 0) {
            setExpandedInvoice(invList[0].invoice_number);
            fetchInvoiceHtml(invList[0].invoice_number);
          }
        }
      })
      .catch((err) => {
        console.warn('Failed to refresh order:', err);
      })
      .finally(() => {
        setLoading(false);
        refreshOrder?.();
      });
  }, [order?.pk, fetchInvoiceHtml, refreshOrder]);

  // Print invoice handler
  const handlePrint = useCallback(
    (invNum: string) => {
      const inv = invoicesList.find((i) => i.invoice_number === invNum);
      if (inv?.pdf_url) {
        window.open(inv.pdf_url, '_blank');
        return;
      }

      // 1. First priority: print directly from the rendered iframe to avoid about:blank popup
      const iframe = document.querySelector(
        `iframe[title="Invoice Preview - ${invNum}"]`
      ) as HTMLIFrameElement | null;

      if (iframe?.contentWindow) {
        try {
          iframe.contentWindow.document.title = `Invoice - ${invNum}`;
        } catch {
          // ignore cross-origin if any
        }
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        return;
      }

      // 2. Fallback: print via hidden iframe in DOM (eliminating about:blank entirely)
      const html = htmlCache[invNum];
      if (html) {
        const printFrame = document.createElement('iframe');
        printFrame.style.position = 'fixed';
        printFrame.style.right = '0';
        printFrame.style.bottom = '0';
        printFrame.style.width = '0';
        printFrame.style.height = '0';
        printFrame.style.border = '0';
        document.body.appendChild(printFrame);

        printFrame.contentDocument?.open();
        const titledHtml = html.includes('<title>')
          ? html.replace(/<title>.*?<\/title>/i, `<title>Invoice - ${invNum}</title>`)
          : `<title>Invoice - ${invNum}</title>${html}`;
        printFrame.contentDocument?.write(titledHtml);
        printFrame.contentDocument?.close();

        setTimeout(() => {
          printFrame.contentWindow?.focus();
          printFrame.contentWindow?.print();
          setTimeout(() => {
            if (document.body.contains(printFrame)) {
              document.body.removeChild(printFrame);
            }
          }, 1500);
        }, 300);
      } else {
        const safeNum = invNum.replace(/[^a-zA-Z0-9_\-]/g, '_');
        window.open(`/media/data_output/SalesOrder-${localOrder?.reference}-${safeNum}.html`, '_blank');
      }
    },
    [invoicesList, htmlCache, localOrder?.reference]
  );

  // Open full invoice HTML in new tab
  const handleOpenNewTab = useCallback(
    (invNum: string) => {
      const html = htmlCache[invNum];
      if (html) {
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      } else {
        const safeNum = invNum.replace(/[^a-zA-Z0-9_\-]/g, '_');
        window.open(`/media/data_output/SalesOrder-${localOrder?.reference}-${safeNum}.html`, '_blank');
      }
    },
    [htmlCache, localOrder?.reference]
  );

  return (
    <Stack gap='md'>
      {/* Top Banner Card */}
      <Paper p='md' withBorder radius='md' bg='gray.0'>
        <Group justify='space-between' align='center'>
          <Group gap='sm'>
            <ThemeIcon size='xl' radius='md' color='blue' variant='filled'>
              <IconFileInvoice size={28} />
            </ThemeIcon>
            <div>
              <Group gap='xs'>
                <Title order={4}>{t`Sales Order Invoices`}</Title>
                <Badge size='sm' color='blue' variant='light'>
                  {invoicesList.length} {invoicesList.length === 1 ? t`Invoice` : t`Invoices`}
                </Badge>
              </Group>
              <Text size='xs' c='dimmed'>
                {t`Enterprise invoices generated for this order. Expand each invoice to review line items, charges, and live document preview.`}
              </Text>
            </div>
          </Group>
          <Group gap='xs'>
            <Button
              variant='default'
              size='sm'
              leftSection={<IconRefresh size={14} />}
              loading={loading}
              onClick={handleRefresh}
            >
              {t`Refresh`}
            </Button>
            <Button
              color='blue'
              size='sm'
              leftSection={<IconPlus size={16} />}
              onClick={onOpenModal}
            >
              {t`Generate Invoice (+)`}
            </Button>
          </Group>
        </Group>
      </Paper>

      {/* Invoices Accordion List */}
      {invoicesList.length > 0 ? (
        <Accordion
          variant='separated'
          radius='md'
          value={expandedInvoice}
          onChange={(val) => {
            setExpandedInvoice(val);
            if (val && !htmlCache[val]) {
              fetchInvoiceHtml(val);
            }
          }}
        >
          {invoicesList.map((inv: any, index: number) => {
            const invNum = inv.invoice_number || `${localOrder?.reference}-${index + 1}`;
            const isLatest = index === 0;
            // Robust itemsCount calculation: if snapshot has items use length, otherwise fallback to SO line count
            const itemsCount =
              Array.isArray(inv.items) && inv.items.length > 0
                ? inv.items.length
                : (localOrder?.line_items || 1);
            const extrasCount = (inv.extra_items || []).length;
            const totalDue = Number(inv.total_amount_due || 0).toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            });

            return (
              <Accordion.Item key={inv.id || invNum || `inv-${index}`} value={invNum}>
                <Accordion.Control>
                  <Group justify='space-between' align='center' pr='sm'>
                    <Group gap='sm' wrap='wrap'>
                      <ThemeIcon
                        size='md'
                        radius='sm'
                        color={isLatest ? 'blue' : 'gray'}
                        variant={isLatest ? 'filled' : 'light'}
                      >
                        <IconFileInvoice size={18} />
                      </ThemeIcon>
                      <div>
                        <Group gap='xs' align='center'>
                          <Text fw={700} size='sm'>
                            {invNum}
                          </Text>
                          {isLatest && (
                            <Badge size='xs' color='green' variant='light'>
                              {t`Latest`}
                            </Badge>
                          )}
                          <Badge size='xs' color='gray' variant='outline'>
                            {inv.generated_date || t`Recent`}
                          </Badge>
                        </Group>
                      </div>

                      <Group gap={6} wrap='wrap'>
                        <Badge size='xs' color='cyan' variant='light'>
                          {itemsCount} {itemsCount === 1 ? t`Item` : t`Items`}
                        </Badge>
                        {extrasCount > 0 && (
                          <Badge size='xs' color='orange' variant='light'>
                            {extrasCount} {t`Charges`}
                          </Badge>
                        )}
                        <Badge size='xs' color='indigo' variant='light'>
                          {inv.ship_method || 'Standard Freight'}
                        </Badge>
                        {inv.tax_rate > 0 && (
                          <Badge size='xs' color='teal' variant='light'>
                            {inv.tax_rate}% {inv.tax_state ? `(${inv.tax_state})` : ''}
                          </Badge>
                        )}
                      </Group>
                    </Group>

                    <Group gap='md'>
                      <div style={{ textAlign: 'right' }}>
                        <Text size='xs' c='dimmed'>
                          {t`Total Amount Due`}
                        </Text>
                        <Text fw={800} size='md' c='blue.7'>
                          ${totalDue}
                        </Text>
                      </div>
                      <Tooltip label={t`Print or Save PDF`}>
                        <ActionIcon
                          size='sm'
                          variant='light'
                          color='blue'
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePrint(invNum);
                          }}
                        >
                          <IconPrinter size={15} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Group>
                </Accordion.Control>

                <Accordion.Panel>
                  <Stack gap='md' pt='xs'>
                    {/* Invoice Key Financial Summary Metrics */}
                    <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing='xs'>
                      <Paper p='xs' withBorder radius='sm' bg='gray.0'>
                        <Text size='xs' c='dimmed'>{t`Subtotal`}</Text>
                        <Text size='sm' fw={700}>
                          ${Number(inv.subtotal || 0).toFixed(2)}
                        </Text>
                      </Paper>
                      <Paper p='xs' withBorder radius='sm' bg='gray.0'>
                        <Group gap={4} align='center'>
                          <IconReceiptTax size={14} color='#0284c7' />
                          <Text size='xs' c='dimmed'>{t`Sales Tax`}</Text>
                        </Group>
                        <Text size='sm' fw={700}>
                          ${Number(inv.tax_amount || 0).toFixed(2)} ({inv.tax_rate ?? 0}%)
                        </Text>
                        {inv.tax_state && (
                          <Text size='10px' c='dimmed'>{inv.tax_state}</Text>
                        )}
                      </Paper>
                      <Paper p='xs' withBorder radius='sm' bg='gray.0'>
                        <Group gap={4} align='center'>
                          <IconTruckDelivery size={14} color='#0284c7' />
                          <Text size='xs' c='dimmed'>{t`Ship Method`}</Text>
                        </Group>
                        <Text size='sm' fw={700}>
                          {inv.ship_method || 'Standard Freight'}
                        </Text>
                      </Paper>
                      <Paper p='xs' withBorder radius='sm' bg='gray.0'>
                        <Group gap={4} align='center'>
                          <IconCalendar size={14} color='#64748b' />
                          <Text size='xs' c='dimmed'>{t`Invoice Date`}</Text>
                        </Group>
                        <Text size='sm' fw={700}>
                          {inv.generated_date || 'N/A'}
                        </Text>
                      </Paper>
                      <Paper p='xs' withBorder radius='sm' bg='blue.0' style={{ borderColor: '#bfdbfe' }}>
                        <Group gap={4} align='center'>
                          <IconCoins size={14} color='#1d4ed8' />
                          <Text size='xs' fw={600} c='blue.9'>{t`Total Due`}</Text>
                        </Group>
                        <Text size='md' fw={800} c='blue.9'>
                          ${totalDue}
                        </Text>
                      </Paper>
                    </SimpleGrid>

                    {/* Line Items & Extra Charges Breakdown Table */}
                    {itemsCount > 0 && (
                      <Paper p='sm' withBorder radius='sm'>
                        <Group justify='space-between' mb='xs'>
                          <Text size='xs' fw={700} tt='uppercase' c='dimmed'>
                            {t`Invoice Line Items & Charges`}
                          </Text>
                          <Group gap='xs'>
                            <Badge size='xs' color='blue' variant='light'>
                              {itemsCount} {itemsCount === 1 ? t`Item` : t`Items`}
                            </Badge>
                            {extrasCount > 0 && (
                              <Badge size='xs' color='orange' variant='light'>
                                {extrasCount} {t`Extra Charges`}
                              </Badge>
                            )}
                          </Group>
                        </Group>
                        <Table striped highlightOnHover withTableBorder>
                          <Table.Thead>
                            <Table.Tr bg='gray.1'>
                              <Table.Th style={{ width: 45 }}>#</Table.Th>
                              <Table.Th>{t`Item / Description`}</Table.Th>
                              <Table.Th style={{ width: 80, textAlign: 'center' }}>{t`UOM`}</Table.Th>
                              <Table.Th style={{ width: 80, textAlign: 'right' }}>{t`Qty`}</Table.Th>
                              <Table.Th style={{ width: 110, textAlign: 'right' }}>{t`Unit Price`}</Table.Th>
                              <Table.Th style={{ width: 120, textAlign: 'right' }}>{t`Extended Price`}</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {Array.isArray(inv.items) && inv.items.length > 0 ? (
                              inv.items.map((it: any, idx: number) => (
                                <Table.Tr key={`it-${idx}`}>
                                  <Table.Td>
                                    <Text size='xs' c='dimmed'>{idx + 1}</Text>
                                  </Table.Td>
                                  <Table.Td>
                                    <Text size='xs' fw={600}>{it.part_name || it.part_ipn}</Text>
                                    {it.description && it.description !== it.part_name && (
                                      <Text size='xs' c='dimmed'>{it.description}</Text>
                                    )}
                                  </Table.Td>
                                  <Table.Td style={{ textAlign: 'center' }}>
                                    <Text size='xs'>{it.units || 'pcs'}</Text>
                                  </Table.Td>
                                  <Table.Td style={{ textAlign: 'right' }}>
                                    <Text size='xs'>{it.quantity}</Text>
                                  </Table.Td>
                                  <Table.Td style={{ textAlign: 'right' }}>
                                    <Text size='xs'>${Number(it.unit_price || 0).toFixed(2)}</Text>
                                  </Table.Td>
                                  <Table.Td style={{ textAlign: 'right' }}>
                                    <Text size='xs' fw={600}>${Number(it.total_price || 0).toFixed(2)}</Text>
                                  </Table.Td>
                                </Table.Tr>
                              ))
                            ) : (
                              <Table.Tr>
                                <Table.Td>
                                  <Text size='xs' c='dimmed'>1</Text>
                                </Table.Td>
                                <Table.Td>
                                  <Text size='xs' fw={600}>{localOrder?.description || t`Sales Order Line Item`}</Text>
                                </Table.Td>
                                <Table.Td style={{ textAlign: 'center' }}>
                                  <Text size='xs'>pcs</Text>
                                </Table.Td>
                                <Table.Td style={{ textAlign: 'right' }}>
                                  <Text size='xs'>1</Text>
                                </Table.Td>
                                <Table.Td style={{ textAlign: 'right' }}>
                                  <Text size='xs'>${Number(inv.subtotal || 0).toFixed(2)}</Text>
                                </Table.Td>
                                <Table.Td style={{ textAlign: 'right' }}>
                                  <Text size='xs' fw={600}>${Number(inv.subtotal || 0).toFixed(2)}</Text>
                                </Table.Td>
                              </Table.Tr>
                            )}
                            {inv.extra_items &&
                              inv.extra_items.map((ex: any, idx: number) => (
                                <Table.Tr key={`ex-${idx}`} bg='orange.0'>
                                  <Table.Td>
                                    <Text size='xs' c='orange.8' fw={700}>+{idx + 1}</Text>
                                  </Table.Td>
                                  <Table.Td>
                                    <Group gap='xs'>
                                      <Badge size='xs' color='orange' variant='light'>
                                        {t`Extra Charge`}
                                      </Badge>
                                      <Text size='xs' fw={600}>{ex.description || 'Additional Charge'}</Text>
                                    </Group>
                                    {ex.notes && <Text size='xs' c='dimmed'>{ex.notes}</Text>}
                                  </Table.Td>
                                  <Table.Td style={{ textAlign: 'center' }}>
                                    <Text size='xs'>EA</Text>
                                  </Table.Td>
                                  <Table.Td style={{ textAlign: 'right' }}>
                                    <Text size='xs'>{ex.quantity}</Text>
                                  </Table.Td>
                                  <Table.Td style={{ textAlign: 'right' }}>
                                    <Text size='xs'>${Number(ex.unit_price || 0).toFixed(2)}</Text>
                                  </Table.Td>
                                  <Table.Td style={{ textAlign: 'right' }}>
                                    <Text size='xs' fw={600}>${Number(ex.total_price || 0).toFixed(2)}</Text>
                                  </Table.Td>
                                </Table.Tr>
                              ))}
                          </Table.Tbody>
                        </Table>
                      </Paper>
                    )}

                    {/* Live Invoice Document Preview Section - Always open inside the accordion item */}
                    <Paper p='sm' withBorder radius='md' bg='gray.0'>
                      <Group justify='space-between' align='center' mb='xs'>
                        <Group gap='xs'>
                          <IconEye size={18} color='#0284c7' />
                          <div>
                            <Text size='sm' fw={700}>
                              {t`Live Invoice Document Preview`}
                            </Text>
                            <Text size='xs' c='dimmed'>
                              {invNum} &bull; {inv.ship_method || 'Standard'} &bull; ${totalDue}
                            </Text>
                          </div>
                        </Group>
                        <Group gap='xs'>
                          <Button
                            variant='default'
                            size='xs'
                            leftSection={<IconRefresh size={14} />}
                            loading={loadingHtml[invNum]}
                            onClick={() => fetchInvoiceHtml(invNum)}
                          >
                            {t`Reload Preview`}
                          </Button>
                          <Button
                            variant='light'
                            color='blue'
                            size='xs'
                            leftSection={<IconExternalLink size={14} />}
                            onClick={() => handleOpenNewTab(invNum)}
                          >
                            {t`Open in New Window`}
                          </Button>
                          {inv.pdf_url && (
                            <Button
                              variant='light'
                              color='teal'
                              size='xs'
                              leftSection={<IconDownload size={14} />}
                              onClick={() => window.open(inv.pdf_url, '_blank')}
                            >
                              {t`Download PDF`}
                            </Button>
                          )}
                          <Button
                            color='blue'
                            size='xs'
                            leftSection={<IconPrinter size={14} />}
                            onClick={() => handlePrint(invNum)}
                          >
                            {t`Print / Save PDF`}
                          </Button>
                        </Group>
                      </Group>

                      {/* Embedded Preview using srcDoc */}
                      <div style={{ paddingTop: 4 }}>
                        {loadingHtml[invNum] ? (
                          <Paper
                            p='xl'
                            withBorder
                            radius='sm'
                            bg='white'
                            style={{
                              height: 480,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexDirection: 'column',
                              gap: 12
                            }}
                          >
                            <Loader size='md' color='blue' />
                            <Text size='sm' c='dimmed'>
                              {t`Rendering formatted invoice document...`}
                            </Text>
                          </Paper>
                        ) : htmlCache[invNum] ? (
                          <iframe
                            srcDoc={htmlCache[invNum]}
                            title={`Invoice Preview - ${invNum}`}
                            style={{
                              width: '100%',
                              height: 760,
                              border: '1px solid #cbd5e1',
                              borderRadius: 6,
                              backgroundColor: '#ffffff',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.06)'
                            }}
                          />
                        ) : (
                          <Paper
                            p='xl'
                            withBorder
                            radius='sm'
                            bg='white'
                            style={{
                              height: 240,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexDirection: 'column',
                              gap: 12
                            }}
                          >
                            <ThemeIcon size='lg' color='gray' variant='light'>
                              <IconFileInvoice size={24} />
                            </ThemeIcon>
                            <Text size='sm' c='dimmed'>
                              {t`Preview document not yet loaded.`}
                            </Text>
                            <Button
                              size='xs'
                              variant='outline'
                              onClick={() => fetchInvoiceHtml(invNum)}
                            >
                              {t`Load Document`}
                            </Button>
                          </Paper>
                        )}
                      </div>
                    </Paper>
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      ) : (
        /* Empty State */
        <Card p='xl' withBorder radius='md' style={{ textAlign: 'center' }}>
          <Stack align='center' gap='sm'>
            <ThemeIcon size={64} radius='xl' color='blue' variant='light'>
              <IconFileInvoice size={36} />
            </ThemeIcon>
            <Title order={4}>{t`No Invoices Generated Yet`}</Title>
            <Text size='sm' c='dimmed' maw={480}>
              {t`An invoice has not been generated for this Sales Order yet. Multiple invoices can be created for initial billing, milestones, shipping charges, or balance payments.`}
            </Text>
            <Button
              mt='sm'
              size='md'
              color='blue'
              leftSection={<IconPlus size={18} />}
              onClick={onOpenModal}
            >
              {t`Generate First Invoice (+)`}
            </Button>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
