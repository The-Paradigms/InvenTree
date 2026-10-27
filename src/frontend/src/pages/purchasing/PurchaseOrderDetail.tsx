import { t } from '@lingui/core/macro';
import { Accordion, Badge, Stack } from '@mantine/core';
import {
  IconCheck,
  IconInfoCircle,
  IconList,
  IconPackages,
  IconX
} from '@tabler/icons-react';
import { type ReactNode, useMemo } from 'react';
import { useParams } from 'react-router-dom';

import { StylishText } from '@lib/components/StylishText';
import { ApiEndpoints } from '@lib/enums/ApiEndpoints';
import { ModelType } from '@lib/enums/ModelType';
import { UserRoles } from '@lib/enums/Roles';
import { apiUrl } from '@lib/functions/Api';
import type { PanelType } from '@lib/types/Panel';
import AdminButton from '../../components/buttons/AdminButton';
import PrimaryActionButton from '../../components/buttons/PrimaryActionButton';
import { PrintingActions } from '../../components/buttons/PrintingActions';
import {
  BarcodeActionDropdown,
  CancelItemAction,
  DuplicateItemAction,
  EditItemAction,
  HoldItemAction,
  OptionsActionDropdown
} from '../../components/items/ActionDropdown';
import InstanceDetail from '../../components/nav/InstanceDetail';
import { PageDetail } from '../../components/nav/PageDetail';
import AttachmentPanel from '../../components/panels/AttachmentPanel';
import NotesPanel from '../../components/panels/NotesPanel';
import { PanelGroup } from '../../components/panels/PanelGroup';
import ParametersPanel from '../../components/panels/ParametersPanel';
import { StatusRenderer } from '../../components/render/StatusRenderer';
import { usePurchaseOrderFields } from '../../forms/PurchaseOrderForms';
import {
  useCreateApiFormModal,
  useEditApiFormModal
} from '../../hooks/UseForm';
import { useInstance } from '../../hooks/UseInstance';
import { useInstanceInfo } from '../../hooks/UseInstanceInfo';
import useStatusCodes from '../../hooks/UseStatusCodes';
import { useGlobalSettingsState } from '../../states/SettingsStates';
import { useUserState } from '../../states/UserState';
import ExtraLineItemTable from '../../tables/general/ExtraLineItemTable';
import { PurchaseOrderLineItemTable } from '../../tables/purchasing/PurchaseOrderLineItemTable';
import { StockItemTable } from '../../tables/stock/StockItemTable';
import { PurchaseOrderDetailsPanel } from './PurchaseOrderDetailsPanel';

/**
 * Detail page for a single PurchaseOrder
 */
export default function PurchaseOrderDetail() {
  const { id } = useParams();

  const user = useUserState();
  const globalSettings = useGlobalSettingsState();

  const {
    instance: order,
    instanceQuery,
    refreshInstance
  } = useInstance({
    endpoint: ApiEndpoints.purchase_order_list,
    pk: id,
    params: {
      supplier_detail: true,
      tags: true
    },
    refetchOnMount: true
  });

  const { instanceInfo } = useInstanceInfo({
    modelType: ModelType.purchaseorder,
    modelId: order?.pk
  });

  const orderCurrency = useMemo(
    () =>
      order.order_currency ||
      order.supplier_detail?.currency ||
      globalSettings.getSetting('INVENTREE_DEFAULT_CURRENCY'),
    [order, globalSettings]
  );

  const purchaseOrderFields = usePurchaseOrderFields({});

  const duplicatePurchaseOrderFields = usePurchaseOrderFields({
    duplicateOrderId: order.pk
  });

  const editPurchaseOrder = useEditApiFormModal({
    url: ApiEndpoints.purchase_order_list,
    pk: id,
    title: t`Edit Purchase Order`,
    fields: purchaseOrderFields,
    queryParams: new URLSearchParams({ tags: 'true' }),
    onFormSuccess: () => {
      refreshInstance();
    }
  });

  const poStatus = useStatusCodes({ modelType: ModelType.purchaseorder });

  const orderOpen: boolean = useMemo(() => {
    return (
      order.status == poStatus.PENDING ||
      order.status == poStatus.PLACED ||
      order.status == poStatus.ON_HOLD
    );
  }, [order, poStatus]);

  const lineItemsEditable: boolean = useMemo(() => {
    if (orderOpen) {
      return true;
    } else {
      return globalSettings.isSet('PURCHASEORDER_EDIT_COMPLETED_ORDERS');
    }
  }, [orderOpen, globalSettings]);

  const duplicatePurchaseOrderInitialData = useMemo(() => {
    const data = { ...order };
    // if we set the reference to null/undefined, it will be left blank in the form
    // if we omit the reference altogether, it will be auto-generated via reference pattern
    // from the OPTIONS response
    delete data.reference;
    return data;
  }, [order]);

  const duplicatePurchaseOrder = useCreateApiFormModal({
    url: ApiEndpoints.purchase_order_list,
    title: t`Add Purchase Order`,
    fields: duplicatePurchaseOrderFields,
    initialData: duplicatePurchaseOrderInitialData,
    follow: true,
    modelType: ModelType.purchaseorder
  });

  const orderPanels: PanelType[] = useMemo(() => {
    return [
      {
        name: 'detail',
        label: t`Order Details`,
        icon: <IconInfoCircle />,
        content: (
          <PurchaseOrderDetailsPanel
            instance={order}
            allowImageEdit
            refreshInstance={refreshInstance}
          />
        )
      },
      {
        name: 'line-items',
        label: t`Line Items`,
        icon: <IconList />,
        content: (
          <Accordion
            multiple={true}
            defaultValue={['line-items', 'extra-items']}
          >
            <Accordion.Item value='line-items' key='lineitems'>
              <Accordion.Control>
                <StylishText size='lg'>{t`Line Items`}</StylishText>
              </Accordion.Control>
              <Accordion.Panel>
                <PurchaseOrderLineItemTable
                  order={order}
                  orderDetailRefresh={refreshInstance}
                  currency={orderCurrency}
                  orderId={Number(id)}
                  editable={lineItemsEditable}
                  supplierId={Number(order.supplier)}
                />
              </Accordion.Panel>
            </Accordion.Item>
            <Accordion.Item value='extra-items' key='extraitems'>
              <Accordion.Control>
                <StylishText size='lg'>{t`Extra Line Items`}</StylishText>
              </Accordion.Control>
              <Accordion.Panel>
                <ExtraLineItemTable
                  endpoint={ApiEndpoints.purchase_order_extra_line_list}
                  importModelType='purchaseorderextraline'
                  orderId={order.pk}
                  orderDetailRefresh={refreshInstance}
                  currency={orderCurrency}
                  editable={lineItemsEditable}
                  role={UserRoles.purchase_order}
                />
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        )
      },
      {
        name: 'received-stock',
        label: t`Received Stock`,
        icon: <IconPackages />,
        content: (
          <StockItemTable
            tableName='received-stock'
            params={{
              purchase_order: id
            }}
          />
        )
      },
      ParametersPanel({
        model_type: ModelType.purchaseorder,
        model_id: order.pk,
        parameter_count: instanceInfo.parameter_count
      }),
      AttachmentPanel({
        model_type: ModelType.purchaseorder,
        model_id: order.pk,
        attachment_count: instanceInfo.attachment_count
      }),
      NotesPanel({
        model_type: ModelType.purchaseorder,
        model_id: order.pk,
        note_count: instanceInfo.note_count,
        // TODO @matmair - change API to include a "locked" attribute that we can check here
        editable:
          order.status == poStatus.COMPLETE &&
          !globalSettings.isSet('PURCHASEORDER_EDIT_COMPLETED_ORDERS')
            ? false
            : undefined
      })
    ];
  }, [order, id, user, instanceInfo]);

  const issueOrder = useCreateApiFormModal({
    url: apiUrl(ApiEndpoints.purchase_order_issue, id),
    title: t`Issue Purchase Order`,
    fields: {},
    ignorePermissionCheck: true,
    onFormSuccess: refreshInstance,
    preFormWarning: t`Issue this order`,
    successMessage: t`Order issued`
  });

  const approveOrder = useCreateApiFormModal({
    url: apiUrl(ApiEndpoints.purchase_order_approve, id),
    title: t`Approve Purchase Order`,
    ignorePermissionCheck: true,
    fields: {
      notes: {
        label: t`Approval Notes`,
        description: t`Optional notes regarding approval`,
        field_type: 'string',
        required: false
      }
    },
    onFormSuccess: refreshInstance,
    preFormWarning: t`Are you sure you want to approve this purchase order?`,
    successMessage: t`Order approved`
  });

  const rejectOrder = useCreateApiFormModal({
    url: apiUrl(ApiEndpoints.purchase_order_reject, id),
    title: t`Reject Purchase Order`,
    ignorePermissionCheck: true,
    fields: {
      notes: {
        label: t`Rejection Reason`,
        description: t`Reason for rejecting this purchase order`,
        field_type: 'string',
        required: true
      }
    },
    onFormSuccess: refreshInstance,
    preFormWarning: t`Are you sure you want to reject this purchase order? It will be placed on hold.`,
    successMessage: t`Order rejected`
  });

  const cancelOrder = useCreateApiFormModal({
    url: apiUrl(ApiEndpoints.purchase_order_cancel, id),
    title: t`Cancel Purchase Order`,
    fields: {},
    ignorePermissionCheck: true,
    onFormSuccess: refreshInstance,
    preFormWarning: t`Cancel this order`,
    successMessage: t`Order cancelled`
  });

  const holdOrder = useCreateApiFormModal({
    url: apiUrl(ApiEndpoints.purchase_order_hold, id),
    title: t`Hold Purchase Order`,
    fields: {},
    ignorePermissionCheck: true,
    onFormSuccess: refreshInstance,
    preFormWarning: t`Place this order on hold`,
    successMessage: t`Order placed on hold`
  });

  const completeOrder = useCreateApiFormModal({
    url: apiUrl(ApiEndpoints.purchase_order_complete, id),
    title: t`Complete Purchase Order`,
    successMessage: t`Order completed`,
    timeout: 10000,
    ignorePermissionCheck: true,
    fields: {
      accept_incomplete: {
        field_type: 'boolean',
        label: t`Accept Incomplete`,
        description: t`Allow order to be closed with incomplete line items`,
        value: false
      }
    },
    onFormSuccess: refreshInstance,
    preFormWarning: t`Mark this order as complete`
  });

  const approvalRequired: boolean = useMemo(() => {
    return globalSettings.isSet('PURCHASEORDER_APPROVAL_REQUIRED', true);
  }, [globalSettings]);

  const approvalThreshold: number = useMemo(() => {
    const threshold = globalSettings.getSetting(
      'PURCHASEORDER_APPROVAL_THRESHOLD',
      '1000'
    );
    return parseFloat(threshold) || 0;
  }, [globalSettings]);

  const orderTotal: number = useMemo(() => {
    return parseFloat(order.total_price ?? 0) || 0;
  }, [order.total_price]);

  const requiresApproval: boolean = useMemo(() => {
    return approvalRequired && orderTotal > approvalThreshold;
  }, [approvalRequired, orderTotal, approvalThreshold]);

  const isApproved: boolean = useMemo(() => {
    return (
      order.approval_status === 'approved' ||
      order.approval_status === 'exempt'
    );
  }, [order.approval_status]);

  const isApprover: boolean = useMemo(() => {
    if (user.isSuperuser() || user.isStaff()) {
      return true;
    }
    const groups = user.user?.groups ?? [];
    return groups.some((g: any) => {
      const name = (typeof g === 'string' ? g : g.name || '').toLowerCase();
      return ['inventory manager', 'inventory managers', 'admin'].includes(
        name
      );
    });
  }, [user]);

  const poActions = useMemo(() => {
    const canAdd: boolean = user.hasAddRole(UserRoles.purchase_order);
    const canEdit: boolean = user.hasChangeRole(UserRoles.purchase_order);

    const canIssue: boolean =
      canAdd &&
      (order.status == poStatus.PENDING || order.status == poStatus.ON_HOLD) &&
      (!requiresApproval || isApproved);

    const canHold: boolean =
      canEdit &&
      (order.status == poStatus.PENDING || order.status == poStatus.PLACED);

    const canComplete: boolean = canEdit && order.status == poStatus.PLACED;

    const canCancel: boolean =
      canEdit &&
      order.status != poStatus.CANCELLED &&
      order.status != poStatus.COMPLETE;

    const canApproveOrReject: boolean =
      isApprover &&
      requiresApproval &&
      (order.status == poStatus.PENDING || order.status == poStatus.ON_HOLD);

    return [
      <PrimaryActionButton
        key='action-issue'
        title={t`Issue Order`}
        icon='issue'
        hidden={!canIssue}
        color='blue'
        onClick={issueOrder.open}
      />,
      <PrimaryActionButton
        key='action-approve'
        title={t`Approve Order`}
        leftSection={<IconCheck size={16} />}
        hidden={!canApproveOrReject || order.approval_status === 'approved'}
        color='teal'
        onClick={approveOrder.open}
      />,
      <PrimaryActionButton
        key='action-reject'
        title={t`Reject Order`}
        leftSection={<IconX size={16} />}
        hidden={!canApproveOrReject || order.approval_status === 'rejected'}
        color='red'
        onClick={rejectOrder.open}
      />,
      <PrimaryActionButton
        key='action-complete'
        title={t`Complete Order`}
        icon='complete'
        hidden={!canComplete}
        color='green'
        onClick={completeOrder.open}
      />,
      <AdminButton
        key='action-admin'
        model={ModelType.purchaseorder}
        id={order.pk}
      />,
      <BarcodeActionDropdown
        key='action-barcode'
        model={ModelType.purchaseorder}
        pk={order.pk}
        hash={order?.barcode_hash}
      />,
      <PrintingActions
        key='action-print'
        modelType={ModelType.purchaseorder}
        items={[order.pk]}
        enableLabels
        enableReports
      />,
      <OptionsActionDropdown
        key='action-options'
        tooltip={t`Order Actions`}
        actions={[
          EditItemAction({
            hidden: !canEdit,
            tooltip: t`Edit order`,
            onClick: () => {
              editPurchaseOrder.open();
            }
          }),
          DuplicateItemAction({
            hidden: !user.hasAddRole(UserRoles.purchase_order),
            onClick: () => duplicatePurchaseOrder.open(),
            tooltip: t`Duplicate order`
          }),
          HoldItemAction({
            tooltip: t`Hold order`,
            hidden: !canHold,
            onClick: holdOrder.open
          }),
          CancelItemAction({
            tooltip: t`Cancel order`,
            hidden: !canCancel,
            onClick: cancelOrder.open
          })
        ]}
      />
    ];
  }, [
    id,
    order,
    user,
    poStatus,
    requiresApproval,
    isApproved,
    isApprover
  ]);

  const orderBadges: ReactNode[] = useMemo(() => {
    if (instanceQuery.isLoading) return [];

    const badges: ReactNode[] = [
      <StatusRenderer
        key='order-status'
        status={order.status_custom_key || order.status}
        type={ModelType.purchaseorder}
        options={{ size: 'lg' }}
      />
    ];

    if (order.approval_status === 'approved') {
      badges.push(
        <Badge key='approval-status' color='teal' size='lg' variant='filled'>
          {t`Approved`}
        </Badge>
      );
    } else if (order.approval_status === 'rejected') {
      badges.push(
        <Badge key='approval-status' color='red' size='lg' variant='filled'>
          {t`Approval Rejected`}
        </Badge>
      );
    } else if (requiresApproval && order.approval_status === 'pending') {
      badges.push(
        <Badge key='approval-status' color='orange' size='lg' variant='filled'>
          {t`Pending Approval`}
        </Badge>
      );
    } else if (order.approval_status === 'exempt') {
      badges.push(
        <Badge key='approval-status' color='gray' size='lg' variant='light'>
          {t`Approval Exempt`}
        </Badge>
      );
    }

    return badges;
  }, [order, instanceQuery, requiresApproval]);

  const subtitle: string = useMemo(() => {
    let t = order.supplier_detail?.name || '';

    if (order.supplier_reference) {
      t += ` (${order.supplier_reference})`;
    }

    return t;
  }, [order]);

  return (
    <>
      {approveOrder.modal}
      {rejectOrder.modal}
      {issueOrder.modal}
      {holdOrder.modal}
      {cancelOrder.modal}
      {completeOrder.modal}
      {editPurchaseOrder.modal}
      {duplicatePurchaseOrder.modal}
      <InstanceDetail
        query={instanceQuery}
        requiredRole={UserRoles.purchase_order}
      >
        <Stack gap='xs'>
          <PageDetail
            title={`${t`Purchase Order`}: ${order.reference}`}
            subtitle={subtitle}
            imageUrl={order.supplier_detail?.image}
            breadcrumbs={[{ name: t`Purchasing`, url: '/purchasing/' }]}
            lastCrumb={[
              {
                name: order.reference,
                url: `/purchasing/purchase-order/${order.pk}`
              }
            ]}
            actions={poActions}
            badges={orderBadges}
            editAction={editPurchaseOrder.open}
            editEnabled={user.hasChangePermission(ModelType.purchaseorder)}
          />
          <PanelGroup
            pageKey='purchaseorder'
            panels={orderPanels}
            model={ModelType.purchaseorder}
            instance={order}
            reloadInstance={refreshInstance}
            id={order.pk}
          />
        </Stack>
      </InstanceDetail>
    </>
  );
}
