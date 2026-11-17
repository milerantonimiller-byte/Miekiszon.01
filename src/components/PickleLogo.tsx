import React from "react";
import {
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Loader2,
  MapPinOff,
  RefreshCw,
  Sun,
} from "lucide-react";
import type { GeoLocation, WeatherData } from "../types";

export const PickleLogo: React.FC<{ size?: number; className?: string }> = ({
  size = 34,
  className = "",
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-label="Logo ogórka Miękiszon"
  >
    <rect width="64" height="64" rx="16" fill="#0D120E" />
    <rect
      x="1"
      y="1"
      width="62"
      height="62"
      rx="15"
      stroke="#22C55E"
      strokeOpacity="0.35"
      strokeWidth="1.5"
    />
    <g transform="translate(32 32) rotate(-18) translate(-32 -32)">
      <path
        d="M32 10C37.5 10 41.5 14.8 41.8 22.8C42.1 30.8 41.5 41.2 40.4 47.4C39.2 53.2 36 55.2 32 55.2C28 55.2 24.8 53.2 23.6 47.4C22.5 41.2 21.9 30.8 22.2 22.8C22.5 14.8 26.5 10 32 10Z"
        fill="url(#pickleHeaderGrad)"
        stroke="#4ADE80"
        strokeWidth="1.75"
      />
      <path
        d="M29.8 15C29 23 28.8 36 29.8 49"
        stroke="#BBF7D0"
        strokeOpacity="0.35"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="27.5" cy="22" r="1.4" fill="#052E16" />
      <circle cx="35.8" cy="27" r="1.6" fill="#052E16" />
      <circle cx="28" cy="34" r="1.4" fill="#052E16" />
      <circle cx="35" cy="40" r="1.3" fill="#052E16" />
      <circle cx="29.5" cy="45.5" r="1.4" fill="#052E16" />
      <path
        d="M32 7.5V10"
        stroke="#4ADE80"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </g>
    <defs>
      <linearGradient
        id="pickleHeaderGrad"
        x1="22"
        y1="10"
        x2="42"
        y2="55"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#22C55E" />
        <stop offset="0.55" stopColor="#15803D" />
        <stop offset="1" stopColor="#052E16" />
      </linearGradient>
    </defs>
  </svg>
);

interface WeatherHeaderWidgetProps {
  weather: WeatherData | null;
  loading: boolean;
  location: GeoLocation | null;
  locationError: string | null;
  onRefresh: () => void;
}

export const WeatherHeaderWidget: React.FC<WeatherHeaderWidgetProps> = ({
  weather,
  loading,
  location,
  locationError,
  onRefresh,
}) => {
  const renderIcon = () => {
    if (loading) {
      return <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />;
    }
    if (!location && locationError) {
      return <MapPinOff className="h-4 w-4 text-amber-400" />;
    }
    const type = weather?.conditionType?.toUpperCase() || "";
    if (type.includes("THUNDER") || type.includes("STORM")) {
      return <CloudLightning className="h-4 w-4 text-amber-300" />;
    }
    if (type.includes("SNOW")) {
      return <CloudSnow className="h-4 w-4 text-sky-300" />;
    }
    if (type.includes("RAIN") || type.includes("DRIZZLE")) {
      return <CloudRain className="h-4 w-4 text-sky-400" />;
    }
    if (type.includes("CLOUD") || type.includes("FOG")) {
      return <Cloud className="h-4 w-4 text-neutral-300" />;
    }
    return <Sun className="h-4 w-4 text-amber-400" />;
  };

  return (
    <button
      type="button"
      onClick={onRefresh}
      title={
        weather
          ? `${weather.description} · Odczuwalna: ${weather.feelsLikeC ?? "—"}°C · Wilgotność: ${weather.humidity ?? "—"}% (${weather.source})`
          : locationError || "Kliknij, aby pobrać lokalną pogodę GPS"
      }
      className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-[#1E2420] bg-[#0D0F0E] px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-emerald-500/40 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
    >
      {weather?.iconUri ? (
        <img
          src={weather.iconUri}
          alt={weather.description || "Pogoda"}
          className="h-4 w-4"
          referrerPolicy="no-referrer"
        />
      ) : (
        renderIcon()
      )}
      {weather && weather.temperatureC !== null ? (
        <span className="font-mono font-medium tabular-nums text-white">
          {Math.round(weather.temperatureC)}°C
        </span>
      ) : (
        <span className="text-neutral-400">
          {loading ? "..." : "GPS"}
        </span>
      )}
      {weather?.description && (
        <span className="hidden lg:inline max-w-[110px] truncate text-neutral-400">
          {weather.description}
        </span>
      )}
      <RefreshCw className="h-3 w-3 text-neutral-500" />
    </button>
  );
};
