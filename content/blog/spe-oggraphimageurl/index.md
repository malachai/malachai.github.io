---
title: SPE SXA Updating OgGraphImageUrl
date: "2019-12-08T11:12:03.284Z"
description: "Sitecore Powershell Script to bulk update SXA OgGraphImageUrl"
---

This script will start at the $rootItem and for each child matching the $sourceTemplate will attempt to extract the Image field (if it exists) and copy this to the OpenGraphImageUrl field

```
$rootItem = Get-Item "{GUID-HERE}"
$sourceTemplate = Get-Item "{GUID-HERE}";

New-UsingBlock (New-Object Sitecore.Data.BulkUpdateContext)
{
    Get-ChildItem $rootItem.FullPath -Recurse | Where-Object { $_.TemplateName -eq $sourceTemplate.Name } | ForEach-Object 
    {
        if(![string]::IsNullOrEmpty($_.Image))
        {
            if ($_.Image -like '*></image>*') {
                $ogImage = $_.Image -replace "></image>", "height=`"675`" width=`"1200`" />"
                Write-Host "$($_.Image) -> $ogImage"
            }
            elseif ($_.Image -like '*/>*') {
                $ogImage = $_.Image -replace "/>", "height=`"675`" width=`"1200`" />"    
                Write-Host "$($_.Image) -> $ogImage"            
            }
            $_.OpenGraphImageUrl = $_.Image
            Publish-Item -Item $_
        }
    }
}
```
![Social Graf](./daria.jpg)