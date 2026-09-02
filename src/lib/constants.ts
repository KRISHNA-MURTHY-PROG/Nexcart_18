export const APP_NAME = "NexCart";
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://nexcart.vercel.app";

// Prices in INR (rupees, not paise)
export const SUBSCRIPTION_PLANS = {
  TRIAL:    { name: "Free Trial", monthlyPrice: 0,   halfYearlyPrice: 0,    yearlyPrice: 0,    productLimit: Infinity, analytics: true,  priority: false, featured: false },
  STANDARD: { name: "Standard",   monthlyPrice: 160, halfYearlyPrice: 875,  yearlyPrice: 1500, productLimit: Infinity, analytics: true,  priority: false, featured: false },
  PREMIUM:  { name: "Premium",    monthlyPrice: 260, halfYearlyPrice: 1400, yearlyPrice: 2400, productLimit: Infinity, analytics: true,  priority: true,  featured: true  },
} as const;

// Billing durations in months
export const BILLING_CYCLES = {
  MONTHLY:     { label: "Monthly",   months: 1,  key: "monthlyPrice"     },
  HALF_YEARLY: { label: "6 months",  months: 6,  key: "halfYearlyPrice"  },
  YEARLY:      { label: "1 year",    months: 12, key: "yearlyPrice"      },
} as const;

export const CATEGORY_PREFIXES: Record<string, string> = {
  electronics: "TECH",
  fashion:     "FASH",
  "home-living": "HOME",
  books:       "BOOK",
  sports:      "SPRT",
  beauty:      "BEAU",
  toys:        "TOYS",
  automotive:  "AUTO",
  garden:      "GRDN",
  jewellery:   "JEWL",
};

export const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING:    "Pending",
  CONFIRMED:  "Confirmed",
  PROCESSING: "Processing",
  SHIPPED:    "Shipped",
  DELIVERED:  "Delivered",
  CANCELLED:  "Cancelled",
  REFUNDED:   "Refunded",
};

export const INDIAN_STATES = [
  "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh",
  "Goa","Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka",
  "Kerala","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram",
  "Nagaland","Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana",
  "Tripura","Uttar Pradesh","Uttarakhand","West Bengal",
  "Delhi","Jammu & Kashmir","Ladakh","Puducherry","Chandigarh",
];

export const MAX_PRODUCT_IMAGES = 8;
export const DEFAULT_PAGE_SIZE = 20;
