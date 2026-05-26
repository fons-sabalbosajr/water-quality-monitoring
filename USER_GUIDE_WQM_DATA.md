# End User Guide: Editing and Modifying WQM Data

This guide is for users who manage water quality monitoring data inside EMBR3-WQMS.

## Sign In

1. Open the EMBR3-WQMS site.
2. Sign in with your approved account.
3. Use the sidebar to access Dashboard, Visualizations, Waterbodies, Tabular Results, and Settings depending on your role.

## Open Tabular Results

1. In the sidebar, open `Tabular Results`.
2. Choose the year:
   - `2026` is the active editable dataset.
   - `2025` and `2024` can be viewed from imported workbook data.
3. Select the waterbody tab you need to edit or review.

## Edit a Station Record

1. Find the station row in the selected waterbody table.
2. Use the edit action for that row.
3. Update the station number, station ID, address, or parameter values.
4. Save the change.

The system keeps station data organized by waterbody, station, parameter, and month.

## Add a Station

1. Open the target waterbody in `Tabular Results`.
2. Choose the add station action.
3. Enter:
   - Station number
   - Station ID or station name
   - Address
   - Monthly values for available parameters
   - Annual average, if applicable
4. Save the station.

Use consistent station names. The visualization and 3D map matching depends on station names, station numbers, and addresses.

## Delete a Station

1. Open the target waterbody in `Tabular Results`.
2. Find the station row.
3. Use the delete action.
4. Confirm only when the station should be removed from the draft dataset.

## Publish or Change the Visualization Year

Users with the required role can open the visualization data settings and choose which WQM year appears in:

- Dashboard
- Visualizations
- Waterbody profiles
- Monitoring views

The published year is shared across those sections so users see one consistent dataset.

## Forecast Charts

Forecast charts are found under `Visualizations > Forecast Charts`.

1. Select a waterbody.
2. Select a station.
3. The app shows the first forecast charts immediately.
4. Use `Show more forecast charts` to display additional parameters.

Forecasts are technical local projections based on monthly values, trend, and RMSE uncertainty. They should support review and planning, not replace formal water quality assessment.

## 3D Waterbody Map

Open `Visualizations > 3D Waterbody Map`.

The map shows:

- Station pins
- Pulsing station markers
- Waterbody or river labels
- Station details below the map
- Coordinates from `wqm_stations.xlsx`

If a station is missing on the map, check that the station name, station number, address, or waterbody label in the workbook matches the tabular WQM data.

## Good Data Entry Practices

- Keep station names consistent across years.
- Avoid extra abbreviations unless they are already used in the workbook.
- Enter numeric values without units inside value fields.
- Keep units in the parameter definition, not in every cell.
- Use blank values for unavailable readings instead of text like `N/A`.
- Review annual averages before saving.

## Common Issues

`No station coordinates matched this waterbody.`

The map workbook may not have a matching station or waterbody name. Review `wqm_stations.xlsx` or ask an administrator to update the coordinate workbook.

`No station parameters with monthly values are available.`

The selected station may have only annual averages or no monthly values for forecastable parameters.

`Unable to load WQM data.`

The backend or database may be unavailable. Contact the system administrator.
