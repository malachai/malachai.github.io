---
title: SPE Create Items based on Media Folder
date: "2019-11-05T09:00:00.000Z"
description: "Sitecore Powershell Script for creating items for each media item"
---

This script walk through each item in the media folder and create a matching item (in this case setting the File and sxatags field) in the content tree

```
function ProcessChildren($path)
{
    $childItems = Get-Item master: -Query $path"/*"
    $childItems | ForEach-Object {
        
        $newPath = $_.FullPath -replace "/sitecore/media library/...", "/sitecore/content/..."
        
        $exists = Test-Path -Path $newPath
        
        if($exists -eq $true)
        {
            Write-Output "$newPath exists"
        }
        else
        {
            # If it's a media folder
            if($_.TemplateID -eq "{FE5DD826-48C6-436D-B87A-7C4210C7413B}")
            {
                # Create a matching File Folder
                $folder = New-Item $newPath -itemtype "{FA81B07C-B634-41B3-AC0D-33C74E829AF9}"
            }
            else
            {
                Write-Host "Creating: " $newPath
                $file = New-Item $newPath -itemtype "<TemplateGUID of new item>"
                
                $filesrc = (($_.Id -replace "-","") -replace "{","") -replace "}",""
                $fileref = "<file mediaid=`"$($_.Id)`" src=`"-/media/$filesrc.ashx`" />"
                
                $file.Editing.BeginEdit();
                $file.File = $fileref
                $file.sxatags = "<SXA tagIds if required>"
                $file.Editing.EndEdit();
            }
        }
        ProcessChildren($_.FullPath)
    }
}

ProcessChildren("/sitecore/....");
```
![Recursion](./1280px-Omega-exp-omega-labeled.svg.png)