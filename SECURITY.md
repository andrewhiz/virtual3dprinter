# Security policy

Virtual 3D Printer is a static, client-side web app. There is no backend, no accounts and no
storage beyond a remembered printer choice in `localStorage`. Photos and 3D model files are
read in the browser and never uploaded.

## Reporting a vulnerability

Please report security issues privately through GitHub: open the repository's **Security** tab
and choose **Report a vulnerability**. Don't open a public issue for anything exploitable.

Include what you found, how to reproduce it (a sample file helps if it involves parsing), and the
browser you used. You can expect a reply within a week. This is a side project, so fixes are best
effort, but they will be credited unless you'd rather stay anonymous.

## Supported versions

Only the latest commit on `main` is supported. That's what the live site at
<https://virtual3dprinter.onthejourney.online/> runs.

## Scope

In scope: anything that lets a crafted file, URL or page state run script, read data from another
origin, or get past the Content-Security-Policy in [`public/_headers`](public/_headers).

Out of scope: a very large or malformed file making your own tab slow or crash (the app already
caps uploads at 80 MB for models and 40 MB for photos), and findings that need a compromised
browser or device.
