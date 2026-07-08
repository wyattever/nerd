# N.E.R.D. Architectural Evolution Log

## Phase 1: FinOps & Core Cleanup (Completed July 2026)
* **Objective**: Remove browser-based overhead from the core research loop to reduce GCP Compute/Memory costs.
* **Decision**: Relocated `LinkValidatorEngine` to `nerd_core/tools/administrative_validators/`. This ensures the engine remains available for manual/on-demand high-fidelity checks while preventing accidental invocation by the automated `worker` pipeline.
* **Outcome**: Successfully transitioned to `resolve_and_validate_all` as the sole validator for the research path. Verified successful artifact generation and local stability.

## Phase 2: Lightweight Liveness & Container Optimization (In Progress)
* **Objective**: Optimize deployment footprint, image size, and cold-start performance per FinOps sprint goals.
* **Decision**: Migrating `nerd-api` to `python:3.12-slim` base image. Decoupled Playwright binaries are now handled only by the administrative worker/job, not the main web API.
* **Outcome**: [Pending] Reduction in image size (from ~800MB+ to <200MB) and lower latency for Cloud Run service scaling.

## Decision Log
* **2026-07-07**: Decided to isolate rather than delete heavy-duty validation tools to support future research requirements (e.g., "soft-404" detection or complex JS-rendered content) without sacrificing core pipeline performance.
* **2026-07-08**: Decided to move toward `slim` images for the primary API entrypoint to maximize infrastructure efficiency.