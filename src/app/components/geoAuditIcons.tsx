import type { CSSProperties } from "react";

type GeoAuditIconProps = {
  /** Default 18 to align with Sparkles in improvement guide header */
  size?: number;
  className?: string;
  style?: CSSProperties;
  "aria-hidden"?: boolean;
};

/** Trophy — strengths / “잘된 점” section */
export function GeoStrengthTrophyIcon({
  size = 18,
  className,
  style,
  "aria-hidden": ariaHidden = true,
}: GeoAuditIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ flexShrink: 0, ...style }}
      aria-hidden={ariaHidden}
    >
      <path
        d="M17 6H16V5C16 3.89543 15.1046 3 14 3H10C8.89543 3 8 3.89543 8 5V6H7C4.79086 6 3 7.79086 3 10V11C3 13.2091 4.79086 15 7 15H8.18182C8.74127 16.9298 10.223 18.4116 12.1528 18.971L12.1818 19V21H10C9.44772 21 9 21.4477 9 22C9 22.5523 9.44772 23 10 23H14C14.5523 23 15 22.5523 15 22C15 21.4477 14.5523 21 14 21H11.8182V19L11.8472 18.971C13.777 18.4116 15.2587 16.9298 15.8182 15H17C19.2091 15 21 13.2091 21 11V10C21 7.79086 19.2091 6 17 6ZM7 13C5.89543 13 5 12.1046 5 11V10C5 8.89543 5.89543 8 7 8H8V13H7ZM19 11C19 12.1046 18.1046 13 17 13H16V8H17C18.1046 8 19 8.89543 19 10V11Z"
        fill="#2ED0BF"
      />
    </svg>
  );
}

/** Triangle alert — “발견된 이슈” section */
export function GeoIssuesAlertIcon({
  size = 18,
  className,
  style,
  "aria-hidden": ariaHidden = true,
}: GeoAuditIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ flexShrink: 0, ...style }}
      aria-hidden={ariaHidden}
    >
      <path d="M12 2L2 22H22L12 2Z" fill="#F4A261" fillOpacity={0.15} />
      <path
        d="M12 8V14M12 18H12.01"
        stroke="#F4A261"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 2L2 22H22L12 2Z"
        stroke="#F4A261"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
