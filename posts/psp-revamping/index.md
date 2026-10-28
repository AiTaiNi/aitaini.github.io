---
title: Revamping an old PSP
published: 2024-08-10
tags: [Video Games, PSP, Consoles, Money Sinks]
description: Fixing an old PSP-1000
category: Video Games
draft: true
---

# Intro

When I was cleaning my room earlier this year, I found an old PSP 1000 I got as a gift from my uncle almost 20 years ago. While still in a not bad condition (most buttons were working, screen worked "fine"), there were a still a few things that needed fixing:

- For starters, the analog stick was missing and from what I remember, had a really bad drift which caused me to remove it as a kid. I remember sending it to get repaired as a kid, only for it to do nothing and keep its drift.

- The Note/Mute button was also missing. Must have dropped it when I opened the PSP to remove the analog stick back then.

- The battery was swollen, which is bad for obvious reasons. I could turn it on but I was a bit worried it would explode so I didn't do much with it.

- Lastly, although minor, the cover for the battery was slightly broken and if I was gonna get it repaired, I might as well get a new one.

As I was looking for a service or store I could get it repaired, I stumbled upon [this store](https://www.facebook.com/gamestore.peru) in a local mall. And so one day, after work, I decided to go alongside a friend to see how much it would cost me. There was a slight scare about the place no longer existing, but thankfully they had only moved stalls and I had just been looking at an old post.

Once there, the attendant gave me a quote for everything that would be done. I committed the dumb mistake of forgetting my PSP at home so I had to come the day after, but eventually I left the patient with its doctor and I went about my day.

# The Repairs

I shall preface that, obviously, all the prices mentioned are in Peruvian New Sol (PEN, S/.), which is around ~0.27 USD or, conversely, 1 USD is equal to ~3.75 PEN.

The repairs I requested were a new joystick, a new battery, a new cover for the battery, a new Note button, a micro SD to Memory Stick adapter and, of course, a general maintenance/cleanup of the insides and shell, as I had assumed the internals must have gotten dusty or worse from the hole left by the missing joystick as well as being forgotten in some box. I also bought a charger for my GBA SP for around S/. 40.

In total, not counting the GBA charger, I paid S/. 250 for the PSP repairs. Sadly, they didn't have a charger for it, but this was enough as I could always buy the accessories elsewhere.

And boy did I buy accessories.

# The Accessories

The repairs obviously took a couple days so, in the meantime, I looked up on YouTube some videos about PSPs in 2023/24 and the amount of customizations I found left in me in awe. USB-C mods for both charging port and data transfer (Despite the 1000 not having USB charging), battery mods for expanded capacity, removing the UMD Drive to allow for various other mods, Bluetooth adapters, IPS screens (For the 1000 only), and so many more things. Sadly, almost all of these mods required soldering, so I decided to avoid them for now.

First of all, thanks to being such an old console with a discontinued system, Custom Firmware for it was essentially perfected, and installing it was incredibly easy. With minimal effort I managed to install the [ARK-4 CFW](https://github.com/PSP-Archive/ARK-4).

After that, I decided on buying accessories and things I would be able to "plug and play":

| Accessory                             | Price      |
| ------------------------------------- | ---------- |
| Original Charger                      | S/.  45.00 |
| PSP to USB charger adapter            | S/.  19.90 |
| 128GB Micro SD                        | S/.  59.86 |
| An original PSP 2000 1200 mAh battery | S/.  45.00 |
| 10000 mAh Xiaomi mini power bank      | S/.  99.54 |


For a nice subtotal of S/. 260.90.

However, it doesn't stop there.

# The Repairs - Part 2

The previous accessories were bought both during the original repairs and way after them. However, after using the PSP for a while, I noticed that the Note button issues were worse than originally though.

Despite the cleaning and replacement button, I noticed that the Home and Brightness buttons were muting the PSP when tapped. It was then that I remembered why it was missing the Note button: I must have removed it as a kid in a (failed) attempt at fixing this issue.

While testing out plugins for the PSP, I installed one that took screenshots. However, immediately after installing, I noticed even simple things like a GBA emulator were _really_ struggling. Like, an incredibly unreasonable drop in performance to the point it was essentially an slideshow. I also noted the free space on my mSD kept going down at an alarming rate every time I went back to the XMB. After a bit of looking around, I noticed I had **hundreds** of screenshots saved from the emulator. It didn't take long to put two and two together.

By default, the plugin used the Note button to take screenshots, and, turns out, that same Note button was being internally held, likely in the connector itself instead of the physical button being the issue. This is also likely why the Home and Brightness buttons mute the PSP, as it interrupts the held signal of the Note button, and, when it comes back, it mutes the PSP, as that's what happens when you hold the Note button. Thankfully, according to the repair guy, getting it fixed would cost only around S/. 40, which hopefully will fix it for good.

Additionally, the original LCD screen now has some ghosting issues due to its age and how much I used it as a kid. It's not _that_ bad, but after seeing the results from IPS screen mods on YouTube, I figured I would ask if the shop did those kind of mods too. They do, but sadly it's on an per-order basis, so I'd need to wait for it to arrive. The mod will cost another S/. 180, with half of it paid in advance so they can make the request for the IPS screen.

As of writing, I'm still waiting for the screen to arrive before dropping off the PSP for both the replacement and the Note button issue, but together they will add another S/. 220 to the total costs.

# The costs.. so far

So, at the end of the day, how much have I spent on this PSP? Well..

|                                       | Cost       |
| ------------------------------------- | ---------- |
| Initial repairs and maintenance       | S/. 250.00 |
| Accessories                           | S/. 430.66 |
| Second bath of repairs and IPS screen | S/. 220.00 |

For a grand total of **_S/. 900.66_**.

Jesus Christ.

Honestly, when you spend a bit here, a bit there, you tend to not notice just how much money you spend, but when I calculated this for the sake of this post, my jaw dropped. Almost a grand gone on this old console.

Even if you consider some of the things I bought as general use that could be used somewhere else (Like the Xiaomi power bank, the second mSD and the UGREEN case, for around S/. 260 and leaving the total at around ~S/. 640), it's still A LOT of money to spend just on something this old and, truthfully, weak. Thankfully, it's all been over the course of several months (From April until August, likely going into September), and MercadoLibre has a no-interest pay in parts option if you use a BCP credit card, which I do have.

To put it into perspective, one really nice looking portable console, the [Retroid Pocket 4 Pro](https://www.goretroid.com/collections/frontpage/products/retroid-pocket-4-handheld), goes for 200 dollars, or around S/. 750, and that can emulate up to PS2 games. Even the beefier [Odin 2](https://www.ayntec.com/products/odin-2), which can apparently emulate up to Switch games, costs 300 dollars (S/. 1120), just barely above what I've spent so far if you include the "optional" accessories. I could have easily bought either of these and just left the PSP in a box again after the initial repairs and gotten a much better and more customizable experience.

Part of me does regret spending this much money, specially now that I see how much it's actually been, but another part of me doesn't mind spending this much on something from my childhood and make it good again.

Would I do it again, for example, for my GBA? **Hell no**. But what's done is done and I might as well see it through now that I've gotten this far in.