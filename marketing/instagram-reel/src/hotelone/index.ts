// Faithful HotelOne UI rebuilds (from the app on origin/claude/admiring-carson-fsuy74),
// inline-styled with theme.ts LIGHT/DARK tokens. Render them inside <Screen>,
// which lays them out at a real phone width (< 640 CSS px) and zooms.
export {Screen, PageFrame, type ScreenProps} from './Screen.tsx';
export {LogoMark, Wordmark, Logo, LOGO_GEOMETRY, type LogoMarkProps, type WordmarkProps, type LogoProps} from './Logo.tsx';
export {Badge, Button, Card, Avatar, SegmentedControl, LAYOUT_SPRING, initials, type BadgeProps, type BadgeVariant, type ButtonProps, type ButtonVariant, type ButtonSize, type SegmentedProps} from './primitives.tsx';
export {
  HouseRulesField,
  HowItSoundsCard,
  Field,
  Input,
  Textarea,
  HOUSE_RULES,
  HOUSE_RULES_HINT,
  STARLITE_GREETING,
  type HouseRulesFieldProps,
  type HowItSoundsCardProps,
  type TextLine,
} from './HouseRulesField.tsx';
export {RateCell, QUEEN_FRI, type RateCellProps} from './RateCell.tsx';
export {
  MessagesList,
  MessageRow,
  MarkerCircle,
  bookingLink,
  formatPhone,
  inbox,
  RITA_REQUEST,
  SAM_REQUEST,
  SAM_LINK,
  SOURCE,
  type GuestRequest,
  type RowFx,
  type MessagesListProps,
  type MessageRowProps,
} from './Messages.tsx';
export {ConsoleHeader, PageHeader, VoiceMessagesPage, STARLITE, type ConsoleHeaderProps, type VoiceMessagesPageProps} from './ConsolePage.tsx';
export {SonnerToast, ToastViewport, COPY_TOAST, SAVED_TOAST, type SonnerToastProps} from './SonnerToast.tsx';
export {VoiceOrb, type VoiceOrbProps} from './VoiceOrb.tsx';
export {Icon, SonnerSuccessIcon, type IconName} from './icons.tsx';
export {HO, RADIUS, TEXT, alpha, mix, shadow, aurora, useHO, ThemeProvider, type Mode, type Tokens} from './tokens.ts';
