import { ApiEndpoints } from '@lib/enums/ApiEndpoints';
import { apiUrl } from '@lib/functions/Api';
import type { ApiFormFieldChoice } from '@lib/types/Forms';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../App';

/**
 * A single discount tier returned by the API.
 */
export interface DiscountTier {
  pk: number;
  name: string;
  description: string;
  discount_percentage: string | number;
  is_active: boolean;
}

/**
 * Fetch all active discount tiers and return them as ApiFormFieldChoice[]
 * so they can be used directly in a `field_type: 'choice'` field.
 *
 * Each choice value is the discount percentage (as a string) so it maps
 * directly onto the existing `discount` DecimalField on the line item.
 */
export function useDiscountTierChoices(): {
  choices: ApiFormFieldChoice[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<DiscountTier[]>({
    queryKey: ['discount-tiers'],
    queryFn: () =>
      api
        .get(apiUrl(ApiEndpoints.discount_tier_list))
        .then((res) => res.data?.results ?? res.data ?? []),
    // Cache for 5 minutes — tiers change rarely
    staleTime: 5 * 60 * 1000
  });

  const choices: ApiFormFieldChoice[] = useMemo(() => {
    const list: ApiFormFieldChoice[] = [
      {
        value: '0',
        display_name: t`No Discount (0%)`
      }
    ];

    if (data && Array.isArray(data)) {
      data.forEach((tier) => {
        if (tier.is_active !== false) {
          const numVal = Number(tier.discount_percentage) || 0;
          list.push({
            value: String(numVal),
            display_name: `${tier.name} — ${numVal}%`
          });
        }
      });
    }

    return list;
  }, [data]);

  return { choices, isLoading };
}
