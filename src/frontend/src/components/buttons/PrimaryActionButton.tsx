import { Button, Tooltip } from '@mantine/core';

import type { InvenTreeIconType } from '@lib/types/Icons';
import { InvenTreeIcon } from '../../functions/icons';

/**
 * A "primary action" button for display on a page detail, (for example)
 */
export default function PrimaryActionButton({
  title,
  tooltip,
  icon,
  color,
  hidden,
  disabled,
  onClick,
  leftSection
}: Readonly<{
  title: string;
  tooltip?: string;
  icon?: keyof InvenTreeIconType;
  color?: string;
  hidden?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  leftSection?: React.ReactNode;
}>) {
  if (hidden) {
    return null;
  }

  const button = (
    <Button
      leftSection={leftSection ?? (icon && <InvenTreeIcon icon={icon} />)}
      color={color}
      radius='sm'
      p='xs'
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
    >
      {title}
    </Button>
  );

  if (tooltip) {
    return (
      <Tooltip label={tooltip} position='bottom'>
        <span style={{ display: 'inline-block', cursor: disabled ? 'not-allowed' : undefined }}>
          {button}
        </span>
      </Tooltip>
    );
  }

  return button;
}
