import { t } from '@lingui/core/macro';
import { ModelType } from '@lib/enums/ModelType';
import type { TableFilter } from '@lib/types/Filters';
import {
  AssignedToMeFilter,
  CompletedAfterFilter,
  CompletedBeforeFilter,
  CreatedAfterFilter,
  CreatedBeforeFilter,
  CreatedByFilter,
  HasProjectCodeFilter,
  HasStartDateFilter,
  HasTargetDateFilter,
  MaxDateFilter,
  MinDateFilter,
  OrderStatusFilter,
  OutstandingFilter,
  OverdueFilter,
  ProjectCodeFilter,
  ResponsibleFilter,
  StartDateAfterFilter,
  StartDateBeforeFilter,
  TagsFilter,
  TargetDateAfterFilter,
  TargetDateBeforeFilter,
  UpdatedAfterFilter,
  UpdatedBeforeFilter
} from '../../components/tables/Filter';

export default function PurchaseOrderFilters({
  includeDateFilters = true
}: {
  includeDateFilters?: boolean;
}): TableFilter[] {
  const filters: TableFilter[] = [
    OrderStatusFilter({ model: ModelType.purchaseorder }),
    OutstandingFilter(),
    OverdueFilter(),
    {
      name: 'approval_status',
      label: t`Approval Status`,
      description: t`Filter by approval status`,
      type: 'choice',
      choices: [
        { value: 'pending', label: t`Pending Approval` },
        { value: 'approved', label: t`Approved` },
        { value: 'rejected', label: t`Rejected` },
        { value: 'exempt', label: t`Exempt` }
      ]
    },
    AssignedToMeFilter(),
    ProjectCodeFilter(),
    HasProjectCodeFilter(),
    ResponsibleFilter(),
    CreatedByFilter(),
    TagsFilter({ modelType: ModelType.purchaseorder })
  ];

  const dateFilters: TableFilter[] = [
    MinDateFilter(),
    MaxDateFilter(),
    CreatedBeforeFilter(),
    CreatedAfterFilter(),
    TargetDateBeforeFilter(),
    TargetDateAfterFilter(),
    StartDateBeforeFilter(),
    StartDateAfterFilter(),
    HasTargetDateFilter(),
    HasStartDateFilter(),
    CompletedBeforeFilter(),
    CompletedAfterFilter(),
    UpdatedBeforeFilter(),
    UpdatedAfterFilter()
  ];

  if (includeDateFilters) {
    filters.push(...dateFilters);
  }

  return filters;
}
