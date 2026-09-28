// NEKODEX design-system component kit. Styles: ../tokens.css + ./components.css (imported once in main.tsx).
// Markup, class names and ARIA follow the system's reference bundle; props follow its index.d.ts.
export { Icon, iconNames, type IconName, type IconProps } from "../icons";
export { cx, useFocusSafeDisabled, type Status, type Tone } from "./shared";
export { Mark, type CatReaction, type MarkProps } from "./Mark";
export {
  Button, Checkbox, IconButton, Select, Switch, TabPanel, Tabs, TextField,
  type ButtonProps, type CheckboxProps, type IconButtonProps, type SelectOption, type SelectProps, type SwitchProps,
  type TabItem, type TabsProps, type TextFieldProps,
} from "./controls";
export {
  Badge, Notice, PhaseSteps, ProgressMeter, StateDot,
  type BadgeProps, type NoticeProps, type PhaseStep, type PhaseStepsProps, type ProgressMeterProps,
} from "./status";
export { Dialog, Toast, type DialogProps, type ToastProps } from "./overlays";
export type { FocusRestoreTarget } from "../modal-focus";
export {
  AccountCard, ConnectionRow, Disclosure, EmptyState, EventList, Hero, Page, Panel, SettingRow, SettingsGroup, SetupRow,
  Stat, StatGroup, SurfaceHeader, codingCatIllustration,
  type AccountCardProps, type ConnectionRowProps, type DisclosureProps, type EmptyStateProps, type EventItem, type HeroProps,
  type PanelProps, type SetupRowProps, type SettingRowProps, type StatGroupProps, type StatProps, type SurfaceHeaderProps,
} from "./content";
