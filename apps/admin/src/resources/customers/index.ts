import { Users } from 'lucide-react';
import { CustomerList } from './CustomerList';
import { CustomerEdit } from './CustomerEdit';

export const customers = {
  list: CustomerList,
  edit: CustomerEdit,
  icon: Users,
  recordRepresentation: (c: { first_name: string; last_name: string }) => `${c.first_name} ${c.last_name}`,
};
