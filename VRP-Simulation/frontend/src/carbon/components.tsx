/* Copyright IBM Corp. 2016, 2026. Apache-2.0. Adapted from Carbon ButtonBase and UIShell/Header; see SOURCE.md. */
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: "primary" | "secondary" | "tertiary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { children, className = "", kind = "primary", size = "md", type = "button", icon, ...rest }, ref,
) {
  return <button {...rest} type={type} ref={ref} className={`cds--btn cds--btn--${kind} cds--btn--${size} ${className}`}>
    {children}{icon && <span className="cds--btn__icon" aria-hidden="true">{icon}</span>}
  </button>;
});

export function Header({ className = "", children, ...rest }: HTMLAttributes<HTMLElement>) {
  return <header {...rest} data-carbon-theme="g100" className={`cds--header ${className}`}>{children}</header>;
}
