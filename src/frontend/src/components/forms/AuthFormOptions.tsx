import { Group } from '@mantine/core';
import { ColorToggle } from '../items/ColorToggle';

export function AuthFormOptions(_props?: Record<string, unknown>) {
  return (
    <Group gap={6} align='center' justify='center' wrap='nowrap'>
      <ColorToggle />
    </Group>
  );
}
