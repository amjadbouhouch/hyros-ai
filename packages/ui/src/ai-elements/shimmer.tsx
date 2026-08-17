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
      animate={
        reduceMotion
          ? undefined
          : { backgroundPosition: "-100% center, 0 0" }
      }
      className={cn(
        "relative inline-block bg-clip-text text-transparent",
        className
      )}
      initial={
        reduceMotion ? false : { backgroundPosition: "100% center, 0 0" }
      }
      style={
        {
          "--spread": `${dynamicSpread}px`,
          backgroundImage:
            "linear-gradient(90deg, transparent calc(50% - var(--spread)), var(--color-foreground) 50%, transparent calc(50% + var(--spread))), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
          backgroundRepeat: "no-repeat, no-repeat",
          backgroundSize: "250% 100%, 100% 100%",
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
