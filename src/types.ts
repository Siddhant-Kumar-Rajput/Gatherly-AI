export type EventKind = "Wedding" | "Birthday" | "Community" | "Custom";
export type VendorStatus = "Interested" | "Confirmed";
export type BudgetStatus = "estimate" | "quoted" | "paid";

export interface BudgetLine {
  id: string;
  category: string;
  estimate: number;
  quoted?: number;
  status: BudgetStatus;
}

export interface PlanTask {
  id: string;
  title: string;
  dueDate: string;
  done: boolean;
  category: string;
}

export interface EventVendor {
  id: string;
  name: string;
  category: string;
  status: VendorStatus;
  address?: string;
  phone?: string;
  mapsUrl?: string;
  placeId?: string;
  rating?: number;
  reviewCount?: number;
  quote?: number;
  notes?: string;
  source?: "sample" | "user" | "google" | "openstreetmap";
}

export interface EventGuest {
  id: string;
  name: string;
  email?: string;
  invited: boolean;
}

export interface EventPlan {
  summary: string;
  highSideTotal: number;
  contingency: number;
  budgetLines: Array<{ category: string; highEstimate: number; rationale: string }>;
  tasks: Array<{ title: string; dueDate: string; category: string }>;
  vendorCategories: string[];
  ideas: string[];
}

export interface EventRecord {
  id: string;
  title: string;
  kind: EventKind;
  customKind?: string;
  date: string;
  city: string;
  guests: number;
  budget: number;
  style: string;
  budgetLines: BudgetLine[];
  tasks: PlanTask[];
  vendorCategories: string[];
  vendors: EventVendor[];
  guestsList: EventGuest[];
  aiSummary?: string;
  aiIdeas?: string[];
  isSample?: boolean;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  createdAt: string;
}
