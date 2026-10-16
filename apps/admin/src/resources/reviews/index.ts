import { MessageSquareText } from 'lucide-react';
import { ReviewList } from './ReviewList';

// The list stays mounted on /reviews/:id and opens the review in a Drawer, like the original demo.
export const reviews = { list: ReviewList, hasEdit: true, icon: MessageSquareText };
