export type WorkspaceTab =
  | "overview"
  | "chat"
  | "food"
  | "routes"
  | "stays"
  | "media"
  | "vision"
  | "phone"
  | "events";

export type MediaSubTab = "image" | "video" | "pdf";
export type RoutesSubMode = "multistop" | "city_travel";
export type PhoneSubSection = "whatsapp" | "intents" | "email";

export interface StaySearchPrefill {
  city: string;
  checkIn?: string;
  checkOut?: string;
  guests?: number;
  autoTrigger?: boolean;
  nonce?: number;
}

export interface StayBookingRecord {
  id: string;
  propertyName: string;
  address: string;
  phone?: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;
  bookingComUrl: string;
  googleHotelsUrl: string;
  websiteUri?: string;
  addedToEvents: boolean;
  status: "Przygotowana automatycznie";
  createdAt: string;
}

export type VoicePreset =
  | "woman_30_warm"
  | "woman_30_pro"
  | "man_calm"
  | "off";

export type GeminiChatModel =
  | "gemini-4-hydrogen"
  | "gemini-4-carbon"
  | "gemini-4-argon"
  | "gemini-3.1-flash-lite";

export interface GeoLocation {
  lat: number;
  lng: number;
}

export interface WeatherData {
  temperatureC: number | null;
  feelsLikeC: number | null;
  humidity: number | null;
  windKmh: number | null;
  conditionType: string;
  description: string;
  iconUri: string | null;
  source: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  timestamp: string;
  model?: string;
  sources?: Array<{ title: string; uri: string; type: "web" | "maps" }>;
  attachmentNames?: string[];
}

export interface AppEvent {
  id: string;
  title: string;
  date: string;
  time: string;
  location?: string;
  category: "Spotkanie" | "Przypomnienie" | "Podróż" | "Zadanie";
  source: "local";
}

export interface FoodPlace {
  id: string;
  name: string;
  address: string;
  phone?: string;
  internationalPhone?: string;
  rating: number;
  userRatingCount: number;
  priceLevel?: string;
  openNow?: boolean;
  googleMapsUri: string;
  lat: number;
  lng: number;
  category: string;
}

export interface LiveFoodUpdate {
  nonce: number;
  locationMode?: "gps" | "city" | "postal";
  city?: string;
  postalCode?: string;
  query?: string;
  radius?: number;
  openNow?: boolean;
  places?: FoodPlace[];
  center?: GeoLocation | null;
  resolvedAreaLabel?: string;
  groundingSummary?: string;
  groundingLinks?: Array<{ title: string; uri: string }>;
  selectedIndex?: number;
  selectedName?: string;
  callPhone?: string;
  callDialHref?: string;
  callPlaceName?: string;
  callAddress?: string;
}

export interface LiveCallBarState {
  active: boolean;
  phase: "idle" | "connecting" | "listening" | "thinking" | "speaking";
  isMicMuted: boolean;
  durationSec: number;
  subtitleUser: string;
  subtitleBot: string;
  cameraFacing: "user" | "environment" | "screen" | null;
}

