"use client";

import { useState } from "react";
import Image from "next/image";
import { listingImageSources } from "@/lib/listing-images";
import {
  ArrowUpRight,
  Bookmark,
  CarFront,
  Fuel,
  Gauge,
  MapPin,
  Pencil,
  ListTodo,
} from "lucide-react";
import {
  fuelNames,
  stageNames,
  transmissionNames,
  type Listing,
} from "@/lib/types";
import { Badge, dateTime, euros, number } from "./ui";

function ListingPhoto({ listing }: { listing: Listing }) {
  const sources = listingImageSources(listing.image_url);
  const [attempt, setAttempt] = useState(0);
  const src = sources[attempt];
  if (!src)
    return (
      <div className="car-placeholder">
        <CarFront size={64} strokeWidth={1} />
        <span>
          {listing.image_url
            ? "Foto derzeit nicht verfügbar"
            : "Kein Foto hinterlegt"}
        </span>
      </div>
    );
  return (
    <a
      href={listing.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={listing.title}
    >
      <Image
        key={src}
        src={src}
        alt={listing.title}
        fill
        unoptimized
        sizes="(max-width: 460px) 100vw, (max-width: 1180px) 50vw, 33vw"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setAttempt((current) => current + 1)}
      />
    </a>
  );
}

export function ListingCard({
  listing,
  sourceLabel,
  onSave,
  onEdit,
  onTask,
  busy,
  asOf,
}: {
  listing: Listing;
  sourceLabel: string;
  asOf: number;
  onSave: () => void;
  onEdit: () => void;
  onTask?: () => void;
  busy: boolean;
}) {
  const stale = asOf - listing.last_seen > 48 * 3600_000;
  return (
    <article className="listing-card">
      <div className="listing-visual">
        <ListingPhoto key={listing.image_url} listing={listing} />
        <span className="source-tag" title={sourceLabel}>
          {sourceLabel}
        </span>
        <button
          className={`bookmark-button ${listing.stage ? "saved" : ""}`}
          aria-label={
            listing.stage
              ? `${listing.title} bearbeiten`
              : `${listing.title} merken`
          }
          onClick={listing.stage ? onEdit : onSave}
          disabled={busy}
        >
          <Bookmark size={18} fill={listing.stage ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="listing-body">
        <div className="listing-topline">
          <span>
            {listing.seller_type === "DEALER"
              ? "Händler"
              : listing.seller_type === "PRIVATE"
                ? "Privat"
                : "Anbieter nicht angegeben"}
          </span>
          {!listing.active ? (
            <Badge tone="amber">Inaktiv</Badge>
          ) : stale ? (
            <span className="stale-label">Stand älter als 48 h</span>
          ) : null}
        </div>
        <a
          href={listing.url}
          target="_blank"
          rel="noopener noreferrer"
          className="listing-title"
        >
          {listing.title}
        </a>
        <strong className="listing-price">{euros(listing.price_cents)}</strong>
        <div className="listing-specs">
          <span>
            <CarFront size={14} />
            {listing.year || "EZ k. A."}
          </span>
          <span>
            <Gauge size={14} />
            {listing.mileage === null
              ? "km k. A."
              : `${number(listing.mileage)} km`}
          </span>
          <span>
            <Fuel size={14} />
            {fuelNames[listing.fuel] || "k. A."}
          </span>
          <span>
            {transmissionNames[listing.transmission] || "Getriebe k. A."}
          </span>
        </div>
        <div className="listing-location">
          <MapPin size={14} />
          {[listing.postal_code, listing.city].filter(Boolean).join(" ") ||
            "Ort nicht angegeben"}
        </div>
        {listing.stage && (
          <button className="stage-button" onClick={onEdit}>
            <span className={`stage-dot ${listing.stage}`} />
            {stageNames[listing.stage]}
            <Pencil size={12} />
          </button>
        )}
        {onTask && (
          <button
            className="text-button listing-task-action"
            disabled={busy}
            onClick={onTask}
            aria-label={`${listing.title}: Aufgabe erstellen`}
          >
            <ListTodo size={15} />
            Aufgabe erstellen
          </button>
        )}
        <div className="listing-bottom">
          <span>Stand {dateTime(listing.last_seen)}</span>
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${listing.title} im Original öffnen`}
          >
            Inserat
            <ArrowUpRight size={14} />
          </a>
        </div>
      </div>
    </article>
  );
}
