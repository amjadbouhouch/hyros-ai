"use client";

import type { MotionProps } from "motion/react";
import { motion, useReducedMotion } from "motion/react";
import type {
  ComponentType,
  CSSProperties,
  ElementType,
  JSX,
} from "react";
import { memo, useMemo } from "react";

import { cn } from "../lib/cn.js";

type MotionHTMLProps = MotionProps & Record<string, unknown>;

// Creating motion components during render produces a new component identity.
// Cache each intrinsic element once, as the upstream AI Elements component does.
const motionComponentCache = new Map<
  keyof JSX.IntrinsicElements,
  ComponentType<MotionHTMLProps>
>();

function getMotionComponent(element: keyof JSX.IntrinsicElements) {
  let component = motionComponentCache.get(element);
  if (!component) {
    component = motion.create(element);
    motionComponentCache.set(element, component);
  }
  return component;
}

export interface ShimmerProps {
  children: string;
  as?: ElementType;
  className?: string;
  duration?: number;
  spread?: number;
}

function ShimmerComponent({
  children,
  as: Component = "p",
  className,
  duration = 2,
  spread = 2,
}: ShimmerProps) {
  const reduceMotion = useReducedMotion();
  const MotionComponent = getMotionComponent(
    Component as keyof JSX.IntrinsicElements
  );
  const dynamicSpread = useMemo(
    () => children.length * spread,
    [children, spread]
  );

  return (
    <MotionComponent
      animate={reduceMotion ? undefined : { backgroundPosition: "0% center" }}
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
        className
      )}
      initial={reduceMotion ? false : { backgroundPosition: "100% center" }}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          backgroundImage:
            "var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
        } as CSSProperties
      }
      transition={
        reduceMotion
          ? undefined
          : {
              duration,
              ease: "linear",
              repeat: Number.POSITIVE_INFINITY,
          }
      }
    >
      {children}
    </MotionComponent>
  );
}

export const Shimmer = memo(ShimmerComponent);
