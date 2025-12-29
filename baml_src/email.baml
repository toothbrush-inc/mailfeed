class Email {
  subject string
  body string
  from string
  to string[]
  cc string[]
  date string
  attachments string[]
  links EmailLink[]
  tags EmailTag[]
}

enum EmailTag {
  ARTICLE_LINK
  REMINDER
  MEETING_INFO
  TODO
  OTHER
}

class EmailLink {
  url string
  title string
}

function IngestEmail(email: string) -> Email {
  // Specify a client as provider/model-name
  // You can also use custom LLM params with a custom client name from clients.baml like "client CustomGPT5" or "client CustomSonnet4"
  client "CustomGemini" // Set OPENAI_API_KEY to use this client.
  prompt #"
    You are a email ingestion agent. Your task is to extract all relevant email details.
    Focus on extracting links from the email content and classifying the type of email with tags.
    
    Email Content:
    {{ email }}

    {{ ctx.output_format }}
  "#
}

test vaibhav_other_email {
  functions [IngestEmail]
  args {
    email #"
      Vaibhav Gupta
      vbv@boundaryml.com

      Experience:
      - Founder at BoundaryML
      - CV Engineer at Google
      - CV Engineer at Microsoft

      Skills:
      - Rust
      - C++
    "#
  }
}

test google_meet_email {
  functions [IngestEmail]
  args {
    email #"
      Delivered-To: dvd@thephotobase.com
Received: by 2002:a05:6a11:ac95:b0:600:ab20:e90a with SMTP id fg21csp109254pxc;
        Mon, 14 Jul 2025 15:22:57 -0700 (PDT)
X-Received: by 2002:a05:6214:419a:b0:6fd:24e8:7b04 with SMTP id 6a1803df08f44-704e5702473mr4703026d6.33.1752531777032;
        Mon, 14 Jul 2025 15:22:57 -0700 (PDT)
ARC-Seal: i=1; a=rsa-sha256; t=1752531777; cv=none;
        d=google.com; s=arc-20240605;
        b=Y+y8VfWRbznw5pg8m9qa/Svd+EdCE02OfdVeu442/7122QsV2fsELE2INKXDO6mvKc
         T+RnTeKoXvaCoN7NKJedRosf+0Ml3p04B/Ys+Dw2Qmy2US9I1abTrmOj/mAOCTcRJhSx
         2fBlf9THXsziNbVB5H1Ecwpc1zU7lWve5S0dX16KluOLwdWhnLulYLut3jUhH5kBPEHX
         r9nO4meZ6w5xm3RPzrE8Vy71H4RSkBLpEBDahUkkf2gWZcZ9xyY+foWwHUocgEAm6B9v
         L6xfiOQei7Csp8fbvQGhSclu7WjEIcZ7PbQ98grKloRkRu9jGABHv9MXL/LBG0cp6JYq
         BDjQ==
ARC-Message-Signature: i=1; a=rsa-sha256; c=relaxed/relaxed; d=google.com; s=arc-20240605;
        h=to:from:subject:date:message-id:sender:reply-to:mime-version
         :dkim-signature:dkim-signature;
        bh=5Um/f0tXTJAopP6yVX0uSSQ0hIitl3l6JSnepXV7yto=;
        fh=x4AotD8lP8IFbX7GiHyLq3ONu6XkT8WcVajbj5OxFdA=;
        b=O3tm/sKVb1L82Y91feTQ8hoXrHsho/dntEWTMnNoLcYmRDqH3Av8vQuNiJWUVDeYXK
         74IfzlMdgZyJ79phIMv0wpoewJAMAZUrPpyYbooKZo3K8FixPFvG3RS47eg7udc2yuSR
         PqcdJWiIRLFGgycIuTN+G9a5ECdG1yRFMDFNhbM0L3RQG9hGc5xcG8Mst2ImPp6vx2be
         gpKRv4mT7G1jTc07abYbkkFiMdxXC332adQ+GumkTYwXH5qh+ZVNLE9vc92TdSomQa23
         1wL29jJsOpAK8scSaRDxxOwqf7uglUblbk0q64mShLEQMhVZFzBBKe4BRdasuCHvP7VI
         kyog==;
        dara=google.com
ARC-Authentication-Results: i=1; mx.google.com;
       dkim=pass header.i=@google.com header.s=20230601 header.b=tehP1d2I;
       dkim=pass header.i=@thephotobase-com.20230601.gappssmtp.com header.s=20230601 header.b=Ie6WNZiW;
       spf=pass (google.com: domain of dvd@thephotobase.com designates 209.85.220.73 as permitted sender) smtp.mailfrom=dvd@thephotobase.com;
       dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=thephotobase.com;
       dara=pass header.i=@thephotobase.com
Return-Path: <dvd@thephotobase.com>
Received: from mail-sor-f73.google.com (mail-sor-f73.google.com. [209.85.220.73])
        by mx.google.com with SMTPS id af79cd13be357-7dcde800f7asor844284685a.11.2025.07.14.15.22.56
        for <dvd@thephotobase.com>
        (Google Transport Security);
        Mon, 14 Jul 2025 15:22:56 -0700 (PDT)
Received-SPF: pass (google.com: domain of dvd@thephotobase.com designates 209.85.220.73 as permitted sender) client-ip=209.85.220.73;
Authentication-Results: mx.google.com;
       dkim=pass header.i=@google.com header.s=20230601 header.b=tehP1d2I;
       dkim=pass header.i=@thephotobase-com.20230601.gappssmtp.com header.s=20230601 header.b=Ie6WNZiW;
       spf=pass (google.com: domain of dvd@thephotobase.com designates 209.85.220.73 as permitted sender) smtp.mailfrom=dvd@thephotobase.com;
       dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=thephotobase.com;
       dara=pass header.i=@thephotobase.com
DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed;
        d=google.com; s=20230601; t=1752531776; x=1753136576; darn=thephotobase.com;
        h=to:from:subject:date:message-id:sender:reply-to:mime-version:from
         :to:cc:subject:date:message-id:reply-to;
        bh=5Um/f0tXTJAopP6yVX0uSSQ0hIitl3l6JSnepXV7yto=;
        b=tehP1d2IP2GmVE2RZcf5a+VbffRmCEXgwQl4cp+YVNRpYdhSRSSoPlrAfwldoyTUZJ
         9fh44oK7hSnmnwO1UXYwphBgcqavugzFq4SeF2PxbrwwzoPh9R/PAybmvSMFptkkJCmY
         xGjEXkpmoj7JqET7DdTm4U7+wgv8bnFnsj0ilJanICwpzA89jj/hVqxkKDIY9a129kJg
         ijc+aeX/tReaRgCClZ9yLlUyg4//Q1rX9P19dNkXwoqWOJmLn2j0uqz1bOtgo0n1AwLq
         dCG7ot63Gp3xRot5464EUaIS/dbd8QrvfSCW7dWiTiuSJiLSgrSx7756xvkCGMF5wHgX
         fvRw==
DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed;
        d=thephotobase-com.20230601.gappssmtp.com; s=20230601; t=1752531776; x=1753136576; darn=thephotobase.com;
        h=to:from:subject:date:message-id:sender:reply-to:mime-version:from
         :to:cc:subject:date:message-id:reply-to;
        bh=5Um/f0tXTJAopP6yVX0uSSQ0hIitl3l6JSnepXV7yto=;
        b=Ie6WNZiWkJ7SOeqeJJ6fl2xNz5xsQYt9xEqkpWmWFDSQvUHGC211Kb0qoNVAxo7EKw
         1+NUP1TKQC4kKJB0VCRzDxuriwt0yMJo7GtXLxj4ktqJ51Tsv3qAHp7r2yFBC1ywF0Mn
         8w9MYBilQY75yQ8CfwsEK6Wrf3faAUobdODVBo6pLsxSglE9viyAFJm+vcxCp1V5xxEp
         LQ3AZF53u9zwiZrguMiHMm32RDe9NfKQ1AkT/p8jy33+gRucFUWQwfb7ydGTWQOQtpM5
         AOfrWrn0BWXj1qsSppAyxknqTejGtL4RI7mMlDNJY7HxHlfYO+1b/XrlVITUYuqdm4+C
         ooCw==
X-Google-DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed;
        d=1e100.net; s=20230601; t=1752531776; x=1753136576;
        h=to:from:subject:date:message-id:sender:reply-to:mime-version
         :x-gm-message-state:from:to:cc:subject:date:message-id:reply-to;
        bh=5Um/f0tXTJAopP6yVX0uSSQ0hIitl3l6JSnepXV7yto=;
        b=F+oQXQ5ZRtwboAp7bSngzlfqkT5UO8TVGD4uWeltBX3Zv844tOR33hP9k8qwk/uool
         US3HNSMdXe3j4NvAhXgNz4UHgfgb8RI8TfL8fB6/t6p/NZDdfzqs6tzb7HOuDe6K15jH
         ga2z0Y3phaKAOmhdCqrmhzPwKREFiem4+yAMM3mCz0k0btGHOIwVkTao9CVFjs75RdS6
         GiW+onXaTK2h3HXKrTOIkiZoNANX5/TfwpMIUtplibG5u2NdGFVA6wv1F3fOf3vxJ6iq
         8xKmx63wmfPCWdH1NaNUeHPKafR71HHO7J9h+kWKpgPaxUxQj3QA/IsSAHZPLfdaBxiC
         YRUw==
X-Gm-Message-State: AOJu0YyvNmPYBDotVcxBd26iB6oD2svCmXOppqyJG3xgXGke7y8+XJp6 7eiXdawTieLbDde3txRIB8MRKNYTOpu/GefrW/4pr1avYoB9+hhuz3DFj+P7jSER4oopTN8Ngkc t5tOuBl7PeJHQ+6TZ3YZPLV8SJilzcmHSyXnZ+egZZA7P8LmIZx3F654X
X-Google-Smtp-Source: AGHT+IEN5ts4kS7B6u/DKIMMC/nybkf5FI+k3nzwC5zFSJsM5EdisqZZ9xfxST+xPhkNdYMvH4kV9Qa2qntxkeVNUQJ/
MIME-Version: 1.0
X-Received: by 2002:a05:620a:172b:b0:7e3:119e:344d with SMTP id af79cd13be357-7e338be521emr83255785a.17.1752531776113; Mon, 14 Jul 2025 15:22:56 -0700 (PDT)
Reply-To: David Dryjanski <dvd@thephotobase.com>
Sender: Google Calendar <calendar-notification@google.com>
Message-ID: <calendar-ae319b5e-e1cb-4509-9289-e6f4d4c87f0f@google.com>
Date: Mon, 14 Jul 2025 22:22:56 +0000
Subject: Appointment booked: Office Hours w/ DVD (Hiroshi Mendoza) @ Tue Jul 15, 2025 10:30am - 11am (PDT) (David Dryjanski)
From: David Dryjanski <dvd@thephotobase.com>
To: David Dryjanski <dvd@thephotobase.com>, hiromendo@gmail.com
Content-Type: multipart/mixed; boundary="000000000000f928e50639eb19f5"

--000000000000f928e50639eb19f5
Content-Type: multipart/alternative; boundary="000000000000f928e30639eb19f3"

--000000000000f928e30639eb19f3
Content-Type: text/plain; charset="UTF-8"; format=flowed; delsp=yes
Content-Transfer-Encoding: base64

T2ZmaWNlIEhvdXJzIHcvIERWRCAoSGlyb3NoaSBNZW5kb3phKQ0KVHVlc2RheSBKdWwgMTUsIDIw
MjUg4ouFIDEwOjMwYW0g4oCTIDExYW0NClBhY2lmaWMgVGltZSAtIExvcyBBbmdlbGVzDQoNCkpv
aW4gd2l0aCBHb29nbGUgTWVldA0KaHR0cHM6Ly9tZWV0Lmdvb2dsZS5jb20vbnd3LXVqcHQtYWF4
P2hzPTIyNA0KDQoNClRlc3QgeW91ciBzZXR1cCBhbnkgdGltZSBiZWZvcmUgeW91ciBhcHBvaW50
bWVudC4NCmh0dHBzOi8vbWVldC5nb29nbGUuY29tL253dy11anB0LWFheD9ocz0yMjQNCg0KTmV3
IHRvIEdvb2dsZSBNZWV0Pw0KTGVhcm4gbW9yZSBhYm91dCBnZXR0aW5nIHN0YXJ0ZWQuDQpodHRw
czovL3N1cHBvcnQuZ29vZ2xlLmNvbS9hL3VzZXJzL2Fuc3dlci85MjgyNzIwDQoNCg0KCQ0KSm9p
biBieSBwaG9uZQ0KKFVTKSArMSA1MTMtNzg4LTIxMzcNClBJTjogODA4OTEwNDQzDQoNCk1vcmUg
cGhvbmUgbnVtYmVycw0KaHR0cHM6Ly90ZWwubWVldC9ud3ctdWpwdC1hYXg/cGluPTg0NTQyMjIx
OTcwNTMmaHM9MA0KQm9va2VkIGJ5DQpIaXJvc2hpIE1lbmRvemENCmhpcm9tZW5kb0BnbWFpbC5j
b20NCkdlbmVyYWwgT2ZmaWNlIEhvdXJzLiBUaGVzZSBhcmUgc3RhbmRpbmcgdGltZXMgZm9yIGRp
c2N1c3Npb24gYW5kIGNoYXRzLg0KDQpDYW5jZWwgb3IgYm9vayBhbm90aGVyIGFwcG9pbnRtZW50
DQpodHRwczovL2NhbGVuZGFyLmdvb2dsZS5jb20vY2FsZW5kYXIvYXBwb2ludG1lbnRzL2Jvb2tp
bmcvQWNac3NaM21IdERBVzRtSkp1ZUVOMmhmTkZRd2dVcm9HY3M5RDBLQ2tpRlQzazBzak9yX1hD
d2t5ZTd4U2ZQWFpFS2EyVVZKSHJmcTk5QWcNCg0Kfn4vL35+DQoJDQpQb3dlcmVkIGJ5IEdvb2ds
ZSBDYWxlbmRhciBhcHBvaW50bWVudCBzY2hlZHVsaW5nLiBVc2UgaXMgc3ViamVjdCB0byB0aGUg
IA0KR29vZ2xlIFByaXZhY3kgUG9saWN5IGFuZCBUZXJtcyBvZiBTZXJ2aWNlLg0KWW91IGFyZSBy
ZWNlaXZpbmcgdGhpcyBlbWFpbCBiZWNhdXNlIHlvdSBhcmUgaW5jbHVkZWQgb24gdGhlIGd1ZXN0
IGxpc3QgZm9yICANCnRoaXMgYm9va2VkIGFwcG9pbnRtZW50Lg0KRm9yd2FyZGluZyB0aGlzIGlu
dml0YXRpb24gY291bGQgYWxsb3cgYW55IHJlY2lwaWVudCB0byBjYW5jZWwgb24geW91ciAgDQpi
ZWhhbGYuDQo=
--000000000000f928e30639eb19f3
Content-Type: text/html; charset="UTF-8"
Content-Transfer-Encoding: quoted-printable

<!doctype html><html xmlns=3D"http://www.w3.org/1999/xhtml" xmlns:v=3D"urn:=
schemas-microsoft-com:vml" xmlns:o=3D"urn:schemas-microsoft-com:office:offi=
ce"><head><title></title><!--[if !mso]><meta http-equiv=3D"X-UA-Compatible"=
 content=3D"IE=3Dedge"><![endif]--><meta http-equiv=3D"Content-Type" conten=
t=3D"text/html; charset=3DUTF-8"><meta name=3D"viewport" content=3D"width=
=3Ddevice-width,initial-scale=3D1"><meta name=3D"color-scheme" content=3D"l=
ight dark"><meta name=3D"supported-color-schemes" content=3D"light dark">
    <style>
      body, html {
        font-family: Roboto, Helvetica, Arial, sans-serif;
      }

      body {
        margin: 0;
        padding: 0;
        -webkit-font-smoothing: antialiased;
        -webkit-text-size-adjust: 100%;
        -ms-text-size-adjust: 100%;
      }

      #outlook a {
        padding: 0;
      }

      .ReadMsgBody {
        width: 100%;
      }

      .ExternalClass {
        width: 100%;
      }

      .ExternalClass * {
        line-height: 100%;
      }

      table,
      td {
        mso-table-lspace: 0pt;
        mso-table-rspace: 0pt;
      }

      img {
        border: 0;
        height: auto;
        line-height: 100%;
        outline: none;
        text-decoration: none;
        -ms-interpolation-mode: bicubic;
      }

      p {
        display: block;
        margin: 13px 0;
      }
    </style>
    <!--[if !mso]><!-->
    <style>
      @media only screen and (max-width:580px) {
        @-ms-viewport {
          width: 320px;
        }

        @viewport {
          width: 320px;
        }
      }
    </style>
    <!--<![endif]-->
    <!--[if mso]>
          <xml>
          <o:OfficeDocumentSettings>
            <o:AllowPNG/>
            <o:PixelsPerInch>96</o:PixelsPerInch>
          </o:OfficeDocumentSettings>
          </xml>
          <![endif]-->
    <!--[if lte mso 11]>
          <style>
            .outlook-group-fix { width:100% !important; }
          </style>
    <![endif]-->

    <!--[if !mso]><!-- -->
  <style>body, html {font-family:Roboto,Helvetica,Arial,sans-serif;}@font-f=
ace {
  font-family: 'Roboto';
  font-style: normal;
  font-weight: 400;
  src: url(//fonts.gstatic.com/s/roboto/v18/KFOmCnqEu92Fr1Mu4mxP.ttf) forma=
t('truetype');
}
@font-face {
  font-family: 'Roboto';
  font-style: normal;
  font-weight: 500;
  src: url(//fonts.gstatic.com/s/roboto/v18/KFOlCnqEu92Fr1MmEU9fBBc9.ttf) f=
ormat('truetype');
}
@font-face {
  font-family: 'Roboto';
  font-style: normal;
  font-weight: 700;
  src: url(//fonts.gstatic.com/s/roboto/v18/KFOlCnqEu92Fr1MmWUlfBBc9.ttf) f=
ormat('truetype');
}
@font-face {
  font-family: 'Material Icons Extended';
  font-style: normal;
  font-weight: 400;
  src: url(//fonts.gstatic.com/s/materialiconsextended/v152/kJEjBvgX7BgnkSr=
UwT8UnLVc38YydejYY-oE_LvM.ttf) format('truetype');
}
@font-face {
  font-family: 'Google Material Icons';
  font-style: normal;
  font-weight: 400;
  src: url(//fonts.gstatic.com/s/googlematerialicons/v144/Gw6kwdfw6UnXLJCcm=
afZyFRXb3BL9rvi0QZG3g.otf) format('opentype');
}

.google-material-icons {
  font-family: 'Google Material Icons';
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
}
@font-face {
  font-family: 'Google Material Icons Filled';
  font-style: normal;
  font-weight: 400;
  src: url(//fonts.gstatic.com/s/googlematerialiconsfilled/v118/WWXFlimHYg6=
HKI3TavMkbKdhBmDvgach8TVpeGsuueSZJH4.otf) format('opentype');
}

.google-material-icons-filled {
  font-family: 'Google Material Icons Filled';
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
}
@font-face {
  font-family: 'Google Sans';
  font-style: normal;
  font-weight: 400;
  src: url(//fonts.gstatic.com/s/googlesans/v14/4UaGrENHsxJlGDuGo1OIlL3Owps=
.ttf) format('truetype');
}
@font-face {
  font-family: 'Google Sans';
  font-style: normal;
  font-weight: 500;
  src: url(//fonts.gstatic.com/s/googlesans/v14/4UabrENHsxJlGDuGo1OIlLU94Yt=
zCwM.ttf) format('truetype');
}
@font-face {
  font-family: 'Google Sans';
  font-style: normal;
  font-weight: 700;
  src: url(//fonts.gstatic.com/s/googlesans/v14/4UabrENHsxJlGDuGo1OIlLV154t=
zCwM.ttf) format('truetype');
}
</style><!--<![endif]-->
      <style>
        .body-container {
          padding-left: 16px;
          padding-right: 16px;
        }
      </style>
 =20
      <style>
        u+.body .body-container,
        body[data-outlook-cycle] .body-container,
        #MessageViewBody .body-container {
          padding-left: 0;
          padding-right: 0;
        }
      </style>
 =20
    <style>
      @media only screen and (min-width:580px) {
        .column-per-37 {
          width: 37% !important;
          max-width: 37%;
        }

        .column-per-63 {
          width: 63% !important;
          max-width: 63%;
        }
      }
    </style>
 =20
    <style>
      .appointment-buttons th {
        display: block;
        clear: both;
        float: left;
        margin-top: 12px;
      }

      .appointment-buttons th a {
        float: left;
      }

      #MessageViewBody .appointment-buttons th {
       margin-top: 24px;
      }
    </style>
 =20
    <style>
      @media only screen and (max-width:580px) {
        table.full-width-mobile {
          width: 100% !important;
        }

        td.full-width-mobile {
          width: auto !important;
        }
      }
    </style>
    <style>
      .main-container-inner,
      .info-bar-inner {
        padding: 12px 16px !important;
      }

      .main-column-table-ltr {
        padding-right: 0 !important;
      }

      .main-column-table-rtl {
        padding-left: 0 !important;
      }

      @media only screen and (min-width:580px) {
        .main-container-inner {
          padding: 24px 32px !important;
        }

        .info-bar-inner {
          padding: 12px 32px !important;
        }

        .main-column-table-ltr {
          padding-right: 32px !important;
        }

        .main-column-table-rtl {
          padding-left: 32px !important;
        }

        .appointment-buttons th {
          display: table-cell;
          clear: none;
        }
      }

      .primary-text {
        color: #3c4043 !important;
      }

      .secondary-text,
      .phone-number a {
        color: #70757a !important;
      }

      .accent-text {
        color: #1a73e8 !important;
      }

      .accent-text-dark {
        color: #185abc !important;
      }

      .grey-button-text,
      .attachment-chip a {
        color: #5f6368 !important;
      }

      .primary-button {
        background-color: #1a73e8 !important;
      }

      .primary-button-text {
        color: #fff !important;
      }

      .underline-on-hover:hover {
        text-decoration: underline !important;
      }

      .grey-infobar-text {
        color: #202124 !important;
      }

      @media (prefers-color-scheme: dark) {
        .primary-text:not([class^=3D"x_"]) {
          color: #e8eaed !important;
        }

        .secondary-text:not([class^=3D"x_"]),
        .phone-number:not([class^=3D"x_"]) a {
          color: #9aa0a6 !important;
        }

        .grey-button-text:not([class^=3D"x_"]),
        .attachment-chip:not([class^=3D"x_"]) a {
          color: #bdc1c6 !important;
        }

        .accent-text:not([class^=3D"x_"]),
        .hairline-button-text:not([class^=3D"x_"]) {
          color: #8ab4f8 !important;
        }

        .primary-button:not([class^=3D"x_"]) {
          background-color: #8ab4f8 !important;
        }

        .primary-button-text:not([class^=3D"x_"]) {
          color: #202124 !important;
        }
      }
    </style>
    <style>
      @media (prefers-color-scheme: dark) {
        .cse-banner:not([class^=3D"x_"]) {
          background-color: #3c4043 !important; /* Google Grey 800 */
        }

        .encryption-icon:not([class^=3D"x_"]) {
          /* WARNING: This causes the whole style tag to get stripped in Gm=
ail. */
          background-image: url('https://fonts.gstatic.com/s/i/googlemateri=
aliconsfilled/encrypted/v3/gm_grey200-24dp/2x/gm_filled_encrypted_gm_grey20=
0_24dp.png') !important;
        }
      }
    </style>
    <!--[if !mso]><!-->
    <style>
      .prevent-link a {
        color: inherit !important;
        text-decoration: none !important;
        font-size: inherit !important;
        font-family: inherit !important;
        font-weight: inherit !important;
        line-height: inherit !important;
      }
    </style>
    <!--<![endif]-->

    <!--[if mso | IE]>
      <style>
        .main-container-inner {
          padding: 24px 32px !important;
        }

        .info-bar-inner {
          padding: 12px 32px !important;
        }

        .cse-banner .encryption-icon {
          /* We use the IE workaround instead. */
          background-image: none !important;
        }

        .cse-banner .encryption-icon .ms-fallback {
          display: block !important;
        }

        /* NB: Some MS clients ignore dark-scheme styling and apply their o=
wn, so there's nothing we can do to help there. */
        @media (prefers-color-scheme: dark) {
          .cse-banner:not([class^=3D"x_"]) .encryption-icon .ms-fallback {
            display: none !important;
          }

          .cse-banner:not([class^=3D"x_"]) .encryption-icon .ms-fallback-da=
rk {
            display: block !important;
          }
        }
      </style>
    <![endif]-->
  </head><body class=3D"body"><div style=3D"display: none; font-size: 1px; =
color: #fff; line-height: 1px; height: 0; max-height: 0; width: 0; max-widt=
h: 0; opacity: 0; overflow: hidden;">Booked by
Hiroshi Mendoza
hiromendo@gmail.com
General Office Hours. These are standing times for discussion and chats.</d=
iv><table border=3D"0" cellpadding=3D"0" cellspacing=3D"0" role=3D"presenta=
tion" align=3D"center" style=3D"width:100%;" class=3D"body-container"><tbod=
y><tr><td style=3D"" class=3D"" align=3D"left"><!--[if mso | IE]><table bor=
der=3D"0" cellpadding=3D"0" cellspacing=3D"0" role=3D"presentation"><tr><td=
 height=3D"16" style=3D"height:16px;"><![endif]--><div style=3D"height:16px=
;" aria-hidden=3D"true"> &nbsp; </div><!--[if mso | IE]></td></tr></table><=
![endif]--><table border=3D"0" cellpadding=3D"0" cellspacing=3D"0" role=3D"=
presentation" align=3D"center" style=3D"width:100%;" class=3D""><tbody><tr>=
<td style=3D"border: solid 1px #dadce0; border-radius: 8px; direction: rtl;=
 font-size: 0; padding: 24px 32px; text-align: center; vertical-align: top;=
" class=3D"main-container-inner"><!--[if mso | IE]><table border=3D"0" cell=
padding=3D"0" cellspacing=3D"0" role=3D"presentation"><tr><![endif]--><!--[=
if mso | IE]><td class=3D"" style=3D"vertical-align:top;width:37%;" ><![end=
if]--><div class=3D"column-per-37 outlook-group-fix" style=3D"font-size: 13=
px; text-align: left; direction: ltr; display: inline-block; vertical-align=
: top; width: 100%;"><table border=3D"0" cellpadding=3D"0" cellspacing=3D"0=
" role=3D"presentation" width=3D"100%"><tbody><tr><td style=3D"vertical-ali=
gn:top;padding:0;"><table border=3D"0" cellpadding=3D"0" cellspacing=3D"0" =
role=3D"presentation" width=3D"100%"><tr><td style=3D"font-size: 0; padding=
: 0; text-align: left; word-break: break-word;;padding-bottom:28px;"><a hre=
f=3D"https://meet.google.com/nww-ujpt-aax?hs=3D224" class=3D"primary-button=
-text" style=3D"font-family: &#39;Google Sans&#39;, Roboto, sans-serif;font=
-size: 14px; letter-spacing: 0.25px; line-height: 20px; mso-line-height-rul=
e: exactly; text-decoration: none; text-transform: none; word-wrap: break-w=
ord; white-space: nowrap;color: #fff;font-weight: 700;white-space: normal;"=
 target=3D"_blank"><table border=3D"0" cellpadding=3D"0" cellspacing=3D"0" =
role=3D"presentation" style=3D"display: inline-block"><tr><td align=3D"cent=
er" role=3D"presentation" valign=3D"middle" style=3D"background-color: #1a7=
3e8; cursor: auto; padding: 10px 25px; border: none; border-radius: 4px; ma=
rgin: 0;" class=3D"primary-button"><!--[if mso]><a href=3D"https://meet.goo=
gle.com/nww-ujpt-aax?hs=3D224" class=3D"primary-button-text" target=3D"_bla=
nk"><![endif]--><span class=3D"primary-button-text" style=3D"font-family: &=
#39;Google Sans&#39;, Roboto, sans-serif;font-size: 14px; letter-spacing: 0=
.25px; line-height: 20px; mso-line-height-rule: exactly; text-decoration: n=
one; text-transform: none; word-wrap: break-word; white-space: nowrap;color=
: #fff;font-weight: 700;white-space: normal;">Join with Google Meet</span><=
!--[if mso]></a><![endif]--></td></tr></table></a></td></tr><tr><td style=
=3D"font-size: 0; padding: 0; text-align: left; word-break: break-word;;pad=
ding-bottom:24px;"><div style=3D"font-family: Roboto, sans-serif;font-size:=
 14px; line-height: 20px; mso-line-height-rule: exactly; text-align: left;"=
><table border=3D"0" cellpadding=3D"0" cellspacing=3D"0" role=3D"presentati=
on" style=3D"padding-bottom: 4px;"><tr><td><h2 class=3D"primary-text" style=
=3D"font-size: 14px;color: #3c4043; text-decoration: none;font-weight: 700;=
-webkit-font-smoothing: antialiased;margin: 0; padding: 0;">Meeting link</h=
2></td></tr></table><!-- Use grey text for the Meet link--><div style=3D"co=
lor: #70757a; text-decoration: none;" class=3D"secondary-text"><a style=3D"=
color: #70757a; text-decoration: none;" class=3D"secondary-text underline-o=
n-hover" href=3D"https://meet.google.com/nww-ujpt-aax?hs=3D224">meet.google=
.com/nww-ujpt-aax</a></div></div></td></tr><tr><td style=3D"font-size: 0; p=
adding: 0; text-align: left; word-break: break-word;;padding-bottom:24px;">=
<div style=3D"font-family: Roboto, sans-serif;font-size: 14px; line-height:=
 20px; mso-line-height-rule: exactly; text-align: left;"><div style=3D"padd=
ing-bottom: 4px;"><a href=3D"https://meet.google.com/nww-ujpt-aax?hs=3D224"=
 style=3D"color: #1a73e8; text-decoration: none;font-weight: 700;" target=
=3D"_blank" class=3D"accent-text">Test your setup</a> <span class=3D"second=
ary-text" style=3D"color: #70757a; text-decoration: none;;">any time before=
 your appointment.</span></div></div></td></tr><tr><td style=3D"font-size: =
0; padding: 0; text-align: left; word-break: break-word;;padding-bottom:24p=
x;"><div style=3D"font-family: Roboto, sans-serif;font-size: 14px; line-hei=
ght: 20px; mso-line-height-rule: exactly; text-align: left;"><div style=3D"=
padding-bottom: 4px;"><div class=3D"secondary-text" style=3D"color: #70757a=
; text-decoration: none;;padding-bottom: 4px;">New to Google Meet?</div><a =
href=3D"https://support.google.com/a/users/answer/9282720" style=3D"color: =
#1a73e8; text-decoration: none;font-weight: 700;" target=3D"_blank" class=
=3D"accent-text">Learn more</a> <span class=3D"secondary-text" style=3D"col=
or: #70757a; text-decoration: none;;">about getting started.</span></div><b=
r><table border=3D"0" cellpadding=3D"0" cellspacing=3D"0" role=3D"presentat=
ion" style=3D"padding-bottom: 4px;"><tr><td><h2 class=3D"primary-text" styl=
e=3D"font-size: 14px;color: #3c4043; text-decoration: none;font-weight: 700=
;-webkit-font-smoothing: antialiased;margin: 0; padding: 0;">Join by phone<=
/h2></td></tr></table><span class=3D"secondary-text" style=3D"color: #70757=
a; text-decoration: none;;">(US) </span><a href=3D"tel:+1-513-788-2137%3B80=
8910443%23" style=3D"color: #1a73e8; text-decoration: none;" target=3D"_bla=
nk" class=3D"accent-text">+1 513-788-2137</a> <br><span class=3D"secondary-=
text" style=3D"color: #70757a; text-decoration: none;;">PIN: 808910443</spa=
n><br><br><a href=3D"https://tel.meet/nww-ujpt-aax?pin=3D8454222197053&amp;=
hs=3D0" style=3D"color: #1a73e8; text-decoration: none;" target=3D"_blank" =
class=3D"accent-text">More phone numbers</a><br></div></td></tr></table></t=
d></tr></tbody></table></div><!--[if mso | IE]></td><![endif]--><!--[if mso=
 | IE]><td class=3D"" style=3D"vertical-align:top;width:63%;padding-right:3=
2px;" ><![endif]--><div class=3D"column-per-63 outlook-group-fix" style=3D"=
font-size: 13px; text-align: left; direction: ltr; display: inline-block; v=
ertical-align: top; width: 100%;"><table border=3D"0" cellpadding=3D"0" cel=
lspacing=3D"0" role=3D"presentation" width=3D"100%" class=3D"main-column-ta=
ble-ltr" style=3D"padding-right: 32px; padding-left: 0;"><tbody><tr><td cla=
ss=3D"main-column-td" style=3D"padding:0; vertical-align:top;"><table borde=
r=3D"0" cellpadding=3D"0" cellspacing=3D"0" role=3D"presentation" width=3D"=
100%"><tr><td style=3D"font-size: 0; padding: 0; text-align: left; word-bre=
ak: break-word;;padding-bottom:2px;"><div style=3D"font-family: &#39;Google=
 Sans&#39;, Roboto, sans-serif;font-weight: 400; font-size: 22px; line-heig=
ht: 28px;color: #3c4043; text-decoration: none;" class=3D"primary-text" rol=
e=3D"presentation"><span itemprop=3D"name">Office Hours w/ DVD (Hiroshi Men=
doza)</span></div></td></tr><tr><td style=3D"font-size: 0; padding: 0; text=
-align: left; word-break: break-word;;padding-bottom:24px;"><div style=3D"f=
ont-family: Roboto, sans-serif;font-style: normal; font-weight: 400; font-s=
ize: 14px; line-height: 20px; letter-spacing: 0.2px;color: #3c4043; text-de=
coration: none;" class=3D"primary-text" role=3D"presentation"><span aria-hi=
dden=3D"true"><time itemprop=3D"startDate" datetime=3D"20250715T173000Z"></=
time><time itemprop=3D"endDate" datetime=3D"20250715T180000Z"></time></span=
><span>Tuesday Jul 15, 2025 =E2=8B=85 10:30am =E2=80=93 11am (Pacific Time =
- Los Angeles)</span></div></td></tr><tr><td style=3D"font-size: 0; padding=
: 0; text-align: left; word-break: break-word;;padding-bottom:24px;"><div s=
tyle=3D"font-family: Roboto, sans-serif;font-style: normal; font-weight: 40=
0; font-size: 14px; line-height: 20px; letter-spacing: 0.2px;color: #3c4043=
; text-decoration: none;" class=3D"primary-text" role=3D"presentation"><spa=
n><b>Booked by</b><br>Hiroshi Mendoza<br><a href=3D"mailto:hiromendo@gmail.=
com" target=3D"_blank">hiromendo@gmail.com</a><br><br>General Office Hours.=
 These are standing times for discussion and chats.</span><meta itemprop=3D=
"description" content=3D"Booked by
Hiroshi Mendoza
hiromendo@gmail.com
General Office Hours. These are standing times for discussion and chats."/>=
</div></td></tr></table></td></tr></tbody></table></div><!--[if mso | IE]><=
/td><![endif]--><!--[if mso | IE]></tr></table><![endif]--></td></tr></tbod=
y></table><table border=3D"0" cellpadding=3D"0" cellspacing=3D"0" role=3D"p=
resentation" align=3D"center" style=3D"width:100%;" class=3D""><tbody><tr><=
td style=3D"font-size: 0; padding: 0; text-align: left; word-break: break-w=
ord;;padding:4px 12px;" class=3D"" align=3D"left"><div class=3D"secondary-t=
ext" style=3D"color: #70757a; text-decoration: none;font-family: Roboto, sa=
ns-serif;font-size: 12px; line-height: 16px; mso-line-height-rule: exactly;=
 text-align: left;"><img alt=3D"" src=3D"https://www.gstatic.com/images/bra=
nding/googlelogo/1x/googlelogo_grey_tm_color_96x40dp.png" style=3D"float:ri=
ght;"/><p>Powered by <a style=3D"color: #1a73e8; text-decoration: none;" hr=
ef=3D"https://workspace.google.com/resources/appointment-scheduling/">Googl=
e Calendar appointment scheduling</a>. Use is subject to the <a style=3D"co=
lor: #1a73e8; text-decoration: none;" href=3D"https://policies.google.com/p=
rivacy">Google Privacy Policy</a> and <a style=3D"color: #1a73e8; text-deco=
ration: none;" href=3D"https://policies.google.com/terms">Terms of Service<=
/a>.</p><p>You are receiving this email because you are included on the gue=
st list for this booked appointment.</p><p>Forwarding this invitation could=
 allow any recipient to cancel on your behalf.</p></div></td></tr></tbody><=
/table></td></tr></tbody></table></body></html>
--000000000000f928e30639eb19f3
Content-Type: text/calendar; charset="UTF-8"; method=REQUEST
Content-Transfer-Encoding: 7bit

BEGIN:VCALENDAR
PRODID:-//Google Inc//Google Calendar 70.9054//EN
VERSION:2.0
CALSCALE:GREGORIAN
METHOD:REQUEST
BEGIN:VTIMEZONE
TZID:America/Los_Angeles
X-LIC-LOCATION:America/Los_Angeles
BEGIN:DAYLIGHT
TZOFFSETFROM:-0800
TZOFFSETTO:-0700
TZNAME:PDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0700
TZOFFSETTO:-0800
TZNAME:PST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
DTSTART;TZID=America/Los_Angeles:20250715T103000
DTEND;TZID=America/Los_Angeles:20250715T110000
DTSTAMP:20250714T222256Z
ORGANIZER;CN=David Dryjanski:mailto:dvd@thephotobase.com
UID:23gni4m4633ae051agnu9fbbfk@google.com
ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE
 ;CN=hiromendo@gmail.com;X-NUM-GUESTS=0:mailto:hiromendo@gmail.com
ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE
 ;CN=David Dryjanski;X-NUM-GUESTS=0:mailto:dvd@thephotobase.com
X-GOOGLE-CONFERENCE:https://meet.google.com/nww-ujpt-aax
X-MICROSOFT-CDO-OWNERAPPTID:414368596
CREATED:20250714T222254Z
DESCRIPTION:<b>Booked by</b>\nHiroshi Mendoza\nhiromendo@gmail.com\n<br>Gen
 eral Office Hours. These are standing times for discussion and chats.\n\n-:
 :~:~::~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~
 :~::~:~::-\nJoin with Google Meet: https://meet.google.com/nww-ujpt-aax\nOr
  dial: (US) +1 513-788-2137 PIN: 808910443#\nMore phone numbers: https://te
 l.meet/nww-ujpt-aax?pin=8454222197053&hs=7\n\nLearn more about Meet at: htt
 ps://support.google.com/a/users/answer/9282720\n\nPlease do not edit this s
 ection.\n-::~:~::~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:
 ~:~:~:~:~:~:~::~:~::-
LAST-MODIFIED:20250714T222254Z
LOCATION:
SEQUENCE:0
STATUS:CONFIRMED
SUMMARY:Office Hours w/ DVD (Hiroshi Mendoza)
TRANSP:OPAQUE
END:VEVENT
END:VCALENDAR

--000000000000f928e30639eb19f3--
--000000000000f928e50639eb19f5
Content-Type: application/ics; name="invite.ics"
Content-Disposition: attachment; filename="invite.ics"
Content-Transfer-Encoding: base64


--000000000000f928e50639eb19f5--
    "#
  }
}
