import { t } from '@lingui/core/macro';
import { useCallback, useMemo, useState } from 'react';

import { AddItemButton } from '@lib/components/AddItemButton';
import {
  type RowAction,
  RowDeleteAction,
  RowEditAction
} from '@lib/components/RowActions';
import { ApiEndpoints } from '@lib/enums/ApiEndpoints';
import { apiUrl } from '@lib/functions/Api';
import useTable from '@lib/hooks/UseTable';
import type { TableFilter } from '@lib/index';
import type { TableColumn } from '@lib/types/Tables';
import {
  BooleanColumn,
  DescriptionColumn
} from '../../components/tables/ColumnRenderers';
import { InvenTreeTable } from '../../components/tables/InvenTreeTable';
import { discountTierFields } from '../../forms/CommonForms';
import {
  useCreateApiFormModal,
  useDeleteApiFormModal,
  useEditApiFormModal
} from '../../hooks/UseForm';
import { useUserState } from '../../states/UserState';

/**
 * Table for displaying and managing configured discount tiers.
 * Authorised staff can create, edit, or deactivate tiers.
 */
export default function DiscountTierTable() {
  const table = useTable('discount-tiers');
  const user = useUserState();

  const isAuthorised = user.isStaff() || user.isSuperuser();

  const [selectedTier, setSelectedTier] = useState<number | undefined>(
    undefined
  );

  const columns: TableColumn[] = useMemo(() => {
    return [
      {
        accessor: 'name',
        title: t`Name`,
        sortable: true,
        switchable: false
      },
      {
        accessor: 'discount_percentage',
        title: t`Discount (%)`,
        sortable: true,
        render: (record: any) => `${record.discount_percentage}%`
      },
      DescriptionColumn({}),
      BooleanColumn({
        accessor: 'is_active',
        title: t`Active`
      })
    ];
  }, []);

  const newDiscountTier = useCreateApiFormModal({
    url: ApiEndpoints.discount_tier_list,
    title: t`Add Discount Tier`,
    fields: discountTierFields(),
    table: table
  });

  const editDiscountTier = useEditApiFormModal({
    url: ApiEndpoints.discount_tier_list,
    pk: selectedTier,
    title: t`Edit Discount Tier`,
    fields: discountTierFields(),
    table: table
  });

  const deleteDiscountTier = useDeleteApiFormModal({
    url: ApiEndpoints.discount_tier_list,
    pk: selectedTier,
    title: t`Delete Discount Tier`,
    table: table
  });

  const rowActions = useCallback(
    (record: any): RowAction[] => {
      return [
        RowEditAction({
          hidden: !isAuthorised,
          onClick: () => {
            setSelectedTier(record.pk);
            editDiscountTier.open();
          }
        }),
        RowDeleteAction({
          hidden: !isAuthorised,
          onClick: () => {
            setSelectedTier(record.pk);
            deleteDiscountTier.open();
          }
        })
      ];
    },
    [isAuthorised, editDiscountTier, deleteDiscountTier]
  );

  const tableFilters: TableFilter[] = useMemo(() => {
    return [
      {
        name: 'is_active',
        label: t`Active`,
        description: t`Show active tiers only`,
        type: 'boolean'
      }
    ];
  }, []);

  const tableActions = useMemo(() => {
    if (!isAuthorised) return [];
    return [
      <AddItemButton
        key='add'
        onClick={() => newDiscountTier.open()}
        tooltip={t`Add discount tier`}
      />
    ];
  }, [isAuthorised, newDiscountTier]);

  return (
    <>
      {newDiscountTier.modal}
      {editDiscountTier.modal}
      {deleteDiscountTier.modal}
      <InvenTreeTable
        url={apiUrl(ApiEndpoints.discount_tier_list)}
        tableState={table}
        columns={columns}
        props={{
          rowActions: rowActions,
          tableActions: tableActions,
          tableFilters: tableFilters
        }}
      />
    </>
  );
}

