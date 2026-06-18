# Official Deployment Announcement

## EMBR3 Water Quality Monitoring System

**Date:** June 18, 2026  
**Status:** Officially Deployed and Live

The EMBR3 Water Quality Monitoring System is now officially deployed and accessible online through the EMBR3 Online Systems portal.

This deployment provides authorized users and stakeholders with access to the system's water quality monitoring tools, public dashboard, and account-based features through the production environment.

## Official Access Links

- Landing Page: https://embr3-onlinesystems.cloud/water-quality-monitoring/welcome
- Login Page: https://embr3-onlinesystems.cloud/water-quality-monitoring/login
- Public Dashboard: https://embr3-onlinesystems.cloud/water-quality-monitoring/public-dashboard

## Deployment Scope

The production deployment includes:

- Public-facing landing page for system access and introduction
- Secure login page for authorized users
- Public dashboard for water quality data viewing
- Backend API deployment under the EMBR3 Online Systems domain
- Integration with the existing VPS and Nginx production environment

## Operational Notes

- The system is now hosted in the production VPS environment.
- Frontend application routing is active under the `/water-quality-monitoring/` base path.
- Backend services are running under PM2 for process management.
- Reverse proxy routing is configured through Nginx under the EMBR3 Online Systems domain.

## Advisory to Users

All users are advised to access the system only through the official production links listed above. Administrators and technical personnel should continue monitoring system logs, service health, and user feedback during the initial production rollout period.

## Issued By

EMBR3 Water Quality Monitoring System Administration  
EMBR3 Online Systems Deployment Team